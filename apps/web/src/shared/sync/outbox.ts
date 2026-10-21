import type { Collection, MutationFnParams } from "@tanstack/db";
import {
  NonRetriableError,
  type OfflineExecutor,
  startOfflineExecutor,
} from "@tanstack/offline-transactions";

import { readFailure } from "../api/client";
import { type ApiFailure, type ReactionGroup, handleProblem } from "../api/problems";
import { newId } from "./ids";

// A outbox do aparelho sobre o @tanstack/offline-transactions (spike 1a, ADR 0030): cada escrita vira uma
// transação persistida com o registro completo e uma Idempotency-Key v7, enviada quando houver rede.
// If-Match e Idempotency-Key só são escritos aqui (frontend.md, "Escrita (push)").

export type Outbox = OfflineExecutor;

/** Envio de uma transação; o pacote não exporta o tipo (`OfflineMutationFn`) na 1.1.1. */
export type OutboxMutationFn<T extends object> = (
  params: MutationFnParams<T> & { idempotencyKey: string },
) => Promise<unknown>;

/**
 * Grupos que voltam para a fila com backoff e a mesma chave. `renew-session` fica aqui até o M4:
 * pausar a fila e renovar a sessão é da sessão; descartar perderia o registro.
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

/** Cabeçalhos do envio de uma transação. O `If-Match` entra aqui no spike 1b. */
export function outboxHeaders(idempotencyKey: string): { "Idempotency-Key": string } {
  return { "Idempotency-Key": idempotencyKey };
}

export interface OutboxConfig {
  collections: Record<string, Collection<any, any, any, any, any>>;
  mutationFns: Record<string, OutboxMutationFn<any>>;
}

export function startOutbox({ collections, mutationFns }: OutboxConfig): Outbox {
  return startOfflineExecutor({
    collections,
    mutationFns,
    shouldRetry,
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
