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
import { canSendAs, expireSession, sessionStore } from "../auth/session";
import { newId } from "./ids";

// A outbox do aparelho sobre o @tanstack/offline-transactions (spike 1a, ADR 0030): cada escrita vira uma
// transação persistida com o registro completo e uma Idempotency-Key v7, enviada quando houver rede, com If-Match
// quando o registro já existe no servidor.
// If-Match e Idempotency-Key só são escritos aqui (frontend.md, "Escrita (push)").

export type Outbox = OfflineExecutor;

/** Envio de uma transação; o pacote não exporta o tipo (`OfflineMutationFn`) na 1.1.1. */
export type OutboxMutationFn<T extends object> = (
  params: MutationFnParams<T> & { idempotencyKey: string },
) => Promise<unknown>;

/**
 * Grupos que voltam para a fila com backoff e a mesma chave. `renew-session` também: a sessão expira (sem refresh
 * até o M4), a fila para e a transação sai depois do próximo login; descartar perderia o registro.
 */
const RETRY_GROUPS: ReadonlySet<ReactionGroup> = new Set(["retry", "renew-session"]);

/** Falha de envio que a outbox tenta de novo. */
export class RetryableSyncError extends Error {
  constructor(
    readonly group: ReactionGroup,
    readonly failure: ApiFailure,
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

/** Transforma o `{ error, response }` de uma chamada que falhou no erro que a mutationFn lança. */
export function syncFailure(result: { error: unknown; response?: Response }): Error {
  const failure = readFailure(result);
  const group = handleProblem(failure);
  if (group === "renew-session") expireSession();
  if (RETRY_GROUPS.has(group)) return new RetryableSyncError(group, failure);
  console.warn("[outbox] transação recusada", group, failure);
  return new RejectedSyncError(group, failure);
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
 * (sessão expirada); com o token de outro usuário também, para a fila de um nunca sair com a conta do outro.
 * Avisa o executor quando a rede volta e quando o dono entra, e ele zera o backoff e envia.
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
  const stopNetwork = network.subscribe(notify);
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

export interface OutboxConfig {
  /** O `user.id` dono da fila: dá nome ao armazenamento e ao lock, e só a sessão dele envia. */
  ownerId: string;
  collections: Record<string, Collection<any, any, any, any, any>>;
  mutationFns: Record<string, OutboxMutationFn<any>>;
}

/** Nome do armazenamento e do lock da outbox de um usuário. */
export const outboxName = (ownerId: string) => `vistoria-outbox-${ownerId}`;

export function startOutbox({ ownerId, collections, mutationFns }: OutboxConfig): Outbox {
  return startOfflineExecutor({
    collections,
    mutationFns,
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
