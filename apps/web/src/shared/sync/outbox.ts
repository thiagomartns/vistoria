import type { Collection, MutationFnParams } from "@tanstack/db";
import {
  IndexedDBAdapter,
  NonRetriableError,
  type OfflineExecutor,
  type OnlineDetector,
  WebLocksLeader,
  WebOnlineDetector,
  startOfflineExecutor,
} from "@tanstack/offline-transactions";

import { readFailure } from "../api/client";
import { type ApiFailure, type ReactionGroup, handleProblem } from "../api/problems";
import { canSendAs, expireSession, renewAfterReconnect, sessionStore } from "../auth/session";
import { newId } from "./ids";

// A outbox do aparelho sobre o @tanstack/offline-transactions (spike 1a, ADR 0030): cada escrita vira uma
// transação persistida com o registro completo e uma Idempotency-Key v7, enviada quando houver rede, com If-Match
// quando o registro já existe no servidor.
// If-Match e Idempotency-Key só são escritos aqui (frontend.md, "Escrita (push)").

export type Outbox = OfflineExecutor;

/**
 * Envio de uma transação; o pacote não exporta o tipo (`OfflineMutationFn`) na 1.1.2. `requeue` põe na fila uma
 * transação nova desta mesma mutationFn, com chave nova: o reenvio de um merge (frontend.md, "Conflito").
 * `removalQueued` diz se há na fila uma exclusão do mesmo registro: aí um conflito não vira reenvio, porque ele sairia
 * depois da exclusão. O `startOutbox` sempre passa os dois; quem chama a mutationFn direto (testes) pode não passar.
 */
export type OutboxMutationFn<T extends object> = (
  params: MutationFnParams<T> & {
    idempotencyKey: string;
    requeue?: (mutate: () => void) => void;
    removalQueued?: () => Promise<boolean>;
  },
) => Promise<unknown>;

/**
 * Grupos que voltam para a fila com backoff e a mesma chave. `renew-session` também: o client já tentou renovar e
 * reenviar (ADR 0045), então a sessão expirou; a fila para e a transação sai depois do próximo login do mesmo usuário.
 * Descartar perderia o registro.
 */
const RETRY_GROUPS: ReadonlySet<ReactionGroup> = new Set(["retry", "renew-session"]);

/** Falha de envio que a outbox tenta de novo. */
export class RetryableSyncError extends Error {
  constructor(
    readonly group: ReactionGroup,
    readonly failure: ApiFailure,
    /** O `Retry-After` da resposta (429 e 409 `idempotency-in-progress`), em ms; sem ele, só o backoff. */
    readonly retryAfterMs?: number,
  ) {
    super(`Envio falhou (${group}); tenta de novo`);
    this.name = "RetryableSyncError";
  }
}

/** Falha que sai da fila. As reações completas de cada grupo são do M2 e do M3; por ora, só registra. */
export class RejectedSyncError extends NonRetriableError {
  constructor(
    readonly group: ReactionGroup,
    readonly failure: ApiFailure,
  ) {
    super(`Envio recusado (${group})`);
    this.name = "RejectedSyncError";
  }
}

/** O teto do `Retry-After` que a outbox respeita: o mesmo do backoff do executor. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** O `Retry-After` em segundos (backend.md, "Cabeçalhos"), em ms; ausente ou ilegível → `undefined`. */
export function readRetryAfter(response?: Response): number | undefined {
  const value = response?.headers.get("Retry-After")?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
}

/** Transforma o `{ error, response }` de uma chamada que falhou no erro que a mutationFn lança. */
export function syncFailure(result: { error: unknown; response?: Response }): Error {
  const failure = readFailure(result);
  const group = handleProblem(failure);
  if (group === "renew-session") expireSession();
  if (RETRY_GROUPS.has(group)) {
    return new RetryableSyncError(group, failure, readRetryAfter(result.response));
  }
  console.warn("[outbox] transação recusada", group, failure);
  return new RejectedSyncError(group, failure);
}

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Espera o `Retry-After` de uma falha antes de ela voltar para a fila. O executor (1.1.2) calcula o atraso só pelo
 * número de tentativas, sem gancho por erro; esperar dentro da mutationFn garante que a próxima tentativa nunca sai
 * antes do que o servidor pediu (o backoff dele soma depois). A fila é serial: nada que pudesse sair antes espera.
 */
export async function waitRetryAfter(error: Error, sleep = delay): Promise<void> {
  if (error instanceof RetryableSyncError && error.retryAfterMs) await sleep(error.retryAfterMs);
}

/**
 * Decide pelo grupo, nunca pelo texto da mensagem: a política padrão do executor para quando a mensagem
 * contém "400", "401" ou "422". Qualquer erro que não seja `RetryableSyncError` é bug: sai da fila.
 */
export function shouldRetry(error: Error): boolean {
  return error instanceof RetryableSyncError;
}

/**
 * Cabeçalhos do envio de uma transação: a chave dela e, quando o registro já existe no servidor, `If-Match` com a
 * versão-base. Sem versão-base (criado no aparelho), nada de `If-Match`: a API cria e ignora o cabeçalho.
 */
export function outboxHeaders(
  idempotencyKey: string,
  baseVersion?: string | null,
): { "Idempotency-Key": string; "If-Match"?: string } {
  return {
    "Idempotency-Key": idempotencyKey,
    ...(baseVersion && { "If-Match": `"${baseVersion}"` }),
  };
}

/**
 * "Online" para a outbox de `ownerId`: rede **e** sessão ativa desse mesmo usuário. Sem token, a fila fica parada
 * (sessão expirada ou renovando); com o token de outro usuário também, para a fila de um nunca sair com a conta do outro.
 * Avisa o executor quando a rede volta e quando o dono entra ou renova, e ele zera o backoff e envia. Na volta da rede,
 * a renovação sai antes do aviso: o executor encontra a sessão `renewing` e só envia depois do refresh.
 */
export function ownerOnlineDetector(
  ownerId: string,
  network: OnlineDetector = new WebOnlineDetector(),
): OnlineDetector {
  const listeners = new Set<() => void>();
  const isOnline = () => network.isOnline() && canSendAs(ownerId);
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let wasOnline = isOnline();
  const stopNetwork = network.subscribe(() => {
    renewAfterReconnect();
    notify();
  });
  const stopSession = sessionStore.subscribe(() => {
    const online = isOnline();
    if (online && !wasOnline) notify();
    wasOnline = online;
  });
  return {
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    notifyOnline: notify,
    isOnline,
    dispose() {
      stopNetwork();
      stopSession();
      network.dispose();
      listeners.clear();
    },
  };
}

// Compactação (frontend.md, "Escrita (push)"): das transações do mesmo registro que nunca foram enviadas, só a mais
// recente sai, e uma exclusão mais nova do registro leva todas as de antes (ADR 0039). O executor (1.1.2) não deixa tirar uma transação da fila (`removeFromOutbox` só apaga do armazenamento,
// e ele a envia mesmo assim), então a compactação acontece quando a mais antiga chega à frente: ela termina sem rede,
// e a mais nova, que leva o registro inteiro, sai no lugar dela.
// "Nunca enviada" não se lê do `retryCount`: ele só sobe depois de uma falha, e uma aba fechada com o envio no ar volta
// com 0, embora o `PUT` possa ter sido aplicado. Por isso a marca de tentativa é gravada antes do envio.

const attemptKey = (idempotencyKey: string) => `vistoria-sent:${idempotencyKey}`;

/** Marca a transação como tentada, antes de a requisição sair. */
export function markAttempted(idempotencyKey: string): void {
  try {
    localStorage.setItem(attemptKey(idempotencyKey), "1");
  } catch {
    // Sem armazenamento, a marca não fica; sem ler a marca, wasAttempted diz que tentou, e nada é compactado.
  }
}

/** A transação já teve uma tentativa. Sem conseguir ler, responde que sim: na dúvida, envia. */
export function wasAttempted(idempotencyKey: string): boolean {
  try {
    return localStorage.getItem(attemptKey(idempotencyKey)) !== null;
  } catch {
    return true;
  }
}

/** Apaga a marca: a transação saiu da fila. */
export function forgetAttempt(idempotencyKey: string): void {
  try {
    localStorage.removeItem(attemptKey(idempotencyKey));
  } catch {
    // Uma marca que sobra só impede compactar uma transação que já saiu da fila.
  }
}

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key) => b.includes(key));

/**
 * A transação nunca tentada tem na fila uma mais nova do mesmo registro e do mesmo envio, ou uma exclusão (`removals`)
 * mais nova dele. "Mais nova" é `createdAt` estritamente maior: num empate, a ordem da fila não é garantida, e não
 * compactar é o lado seguro.
 */
async function isSuperseded(
  outbox: Outbox | undefined,
  transactionId: string,
  removals: ReadonlySet<string>,
): Promise<boolean> {
  const queued = (await outbox?.peekOutbox()) ?? [];
  const self = queued.find((transaction) => transaction.id === transactionId);
  if (!self || self.retryCount > 0) return false;
  return queued.some(
    (transaction) =>
      transaction.createdAt.getTime() > self.createdAt.getTime() &&
      (transaction.mutationFnName === self.mutationFnName ||
        removals.has(transaction.mutationFnName)) &&
      sameKeys(transaction.keys, self.keys),
  );
}

/** Há na fila, além desta, uma exclusão (`removals`) do mesmo registro. */
async function isRemovalQueued(
  outbox: Outbox | undefined,
  transactionId: string,
  removals: ReadonlySet<string>,
): Promise<boolean> {
  const queued = (await outbox?.peekOutbox()) ?? [];
  const self = queued.find((transaction) => transaction.id === transactionId);
  if (!self) return false;
  return queued.some(
    (transaction) =>
      transaction.id !== self.id &&
      removals.has(transaction.mutationFnName) &&
      sameKeys(transaction.keys, self.keys),
  );
}

/** Embrulha um envio com a compactação e a marca de tentativa. `removals`: os envios que excluem o registro. */
export function compacting(
  send: OutboxMutationFn<any>,
  outbox: () => Outbox | undefined,
  removals: ReadonlySet<string> = new Set(),
): OutboxMutationFn<any> {
  return async (params) => {
    const { transaction, idempotencyKey } = params;
    if (!wasAttempted(idempotencyKey) && (await isSuperseded(outbox(), transaction.id, removals)))
      return;
    markAttempted(idempotencyKey);
    try {
      const result = await send({
        ...params,
        removalQueued: () => isRemovalQueued(outbox(), transaction.id, removals),
      });
      forgetAttempt(idempotencyKey);
      return result;
    } catch (error) {
      if (!(error instanceof RetryableSyncError)) forgetAttempt(idempotencyKey);
      throw error;
    }
  };
}

export interface OutboxConfig {
  /** O `user.id` dono da fila: dá nome ao armazenamento e ao lock, e só a sessão dele envia. */
  ownerId: string;
  collections: Record<string, Collection<any, any, any, any, any>>;
  mutationFns: Record<string, OutboxMutationFn<any>>;
  /** As mutationFns que excluem o registro: compactam as escritas nunca tentadas dele que estão antes na fila. */
  removals?: ReadonlySet<string>;
}

/** Nome do armazenamento e do lock da outbox de um usuário. */
export const outboxName = (ownerId: string) => `vistoria-outbox-${ownerId}`;

export function startOutbox({
  ownerId,
  collections,
  mutationFns,
  removals = new Set(),
}: OutboxConfig): Outbox {
  // O executor só envia depois de iniciar (assíncrono), e aí `outbox` já existe.
  let outbox: Outbox | undefined;
  const compacted = Object.fromEntries(
    Object.entries(mutationFns).map(([name, send]) => {
      const requeue = (mutate: () => void) => {
        if (outbox) enqueue(outbox, name, mutate);
      };
      return [
        name,
        compacting((params) => send({ ...params, requeue }), () => outbox, removals),
      ];
    }),
  );
  outbox = startOfflineExecutor({
    collections,
    mutationFns: compacted,
    shouldRetry,
    // Sem IndexedDB ou Web Locks, o executor escolhe sozinho (localStorage, BroadcastChannel).
    ...(typeof indexedDB !== "undefined" && { storage: new IndexedDBAdapter(outboxName(ownerId)) }),
    // Lock por dono: ao trocar de usuário, a outbox nova não disputa o lock que a anterior ainda está soltando.
    ...(WebLocksLeader.isSupported() && {
      leaderElection: new WebLocksLeader(outboxName(ownerId)),
    }),
    onlineDetector: ownerOnlineDetector(ownerId),
    onStorageFailure: (diagnostic) => console.warn("[outbox] sem armazenamento", diagnostic),
  });
  return outbox;
}

/**
 * Enfileira uma escrita: `mutate` aplica a mudança otimista na collection, e a transação vai para a outbox
 * com uma chave nova, gerada agora e persistida junto. Uma transação, um registro, um corpo, uma chave.
 */
export function enqueue(outbox: Outbox, mutationFnName: string, mutate: () => void): void {
  const transaction = outbox.createOfflineTransaction({
    mutationFnName,
    idempotencyKey: newId(),
    autoCommit: false,
  });
  transaction.mutate(mutate);
  // A recusa já foi registrada em syncFailure e desfaz o otimista; aqui só evita a rejeição solta.
  transaction.commit().catch(() => {});
}
