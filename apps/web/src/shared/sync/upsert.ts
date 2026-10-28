import type { PendingMutation } from "@tanstack/db";

import type { ApiFailure } from "../api/problems";
import {
  type DraftsCollection,
  clearDraft,
  currentOf,
  rebaseDraft,
  recordConflict,
  recordRejection,
  workingCopy,
} from "./drafts";
import { isOwnWrite, mergeFields, recordShape, sameValue } from "./merge";
import {
  type OutboxMutationFn,
  RejectedSyncError,
  outboxHeaders,
  syncFailure,
  waitRetryAfter,
} from "./outbox";
import { recordSyncSuccess } from "./sync-status";

// O envio de um registro pelo `PUT` de upsert (ADR 0028), igual em toda entidade: a feature só diz qual chamada do
// client gerado faz o `PUT` e, se o registro não for plano, como fazer o merge dele.

/** Um registro no banco local: o corpo do `PUT`, o `id` gerado no aparelho e a `version` que o servidor confirmou. */
export type SyncRecord = { id: string; version: string | null };

/** A store onde o registro vai depois do 2xx (as `utils` de uma collection IndexedDB). */
export interface ConfirmedStore<T> {
  utils: {
    exportData: () => Promise<T[]>;
    acceptMutations: (transaction: { mutations: PendingMutation[] }) => Promise<void>;
  };
}

/**
 * A collection do registro: a store confirmada (`utils`) e a camada otimista por cima, com o que está na fila. O merge
 * de um conflito lê dela o registro mais novo e escreve nela o mesclado, na transação do reenvio.
 */
export interface LocalCollection<T> extends ConfirmedStore<T> {
  get: (id: string) => T | undefined;
  has: (id: string) => boolean;
  insert: (record: T) => unknown;
  update: (id: string, change: (draft: T) => void) => unknown;
}

/** A chamada gerada do `PUT /api/v1/<entidade>/{id}`. */
export type UpsertCall<T extends SyncRecord> = (request: {
  path: { id: string };
  body: Omit<T, "id" | "version">;
  headers: ReturnType<typeof outboxHeaders>;
}) => Promise<{ data?: { version: string }; error?: unknown; response?: Response }>;

/** O merge de três vias de uma entidade (frontend.md, "Conflito", passo 2). */
export interface MergeStrategy<T extends SyncRecord> {
  /** O `current` do servidor na forma do registro local, com a `version` dele. */
  shape: (current: Record<string, unknown>, like: T) => T;
  merge: (base: T | undefined, local: T, server: T) => { merged: T; collisions: unknown[] };
}

/** O merge plano por campo, de cliente e imóvel (ADR 0038). */
export const flatMerge: MergeStrategy<any> = { shape: recordShape, merge: mergeFields };

/**
 * O registro como o servidor o confirmou por último (a `serverShadow` do merge), lido da store na hora do envio. A
 * `version` dele é a versão-base do envio (e não a da transação). Assim duas edições seguidas saem encadeadas: a segunda leva a versão que a primeira
 * devolveu. Vale porque a store só recebe o que o servidor confirmou; o pull do M4 não pode sobrescrever registro
 * com pendência (frontend.md, "Leitura").
 */
async function confirmedOf<T extends SyncRecord>(
  store: ConfirmedStore<T>,
  id: string,
): Promise<T | undefined> {
  return (await store.utils.exportData()).find((record) => record.id === id);
}

/** Grava na store confirmada, pela mutação da transação, o registro como o servidor o tem agora. */
async function confirm<T extends SyncRecord>(
  store: ConfirmedStore<T>,
  mutation: PendingMutation<T>,
  record: T,
): Promise<void> {
  // Na 0.15, acceptMutations tipa as mutações como Record<string, unknown>, não pelo item da collection.
  await store.utils.acceptMutations({
    mutations: [{ ...mutation, modified: record }],
  } as unknown as {
    mutations: PendingMutation[];
  });
}

/** O `current` de um `version-conflict`. `deleted` e uma resposta sem `current` (fora do contrato) não têm. */
function versionConflictCurrent(failure: ApiFailure): Record<string, unknown> | undefined {
  if (
    failure.kind !== "problem" ||
    failure.problem.type !== "urn:vistoria:problem:version-conflict"
  )
    return;
  const current = failure.problem.current;
  return typeof current === "object" && current !== null && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : undefined;
}

/**
 * Envia a transação pelo `PUT` com o registro completo, a chave da transação e `If-Match` quando o registro já está
 * no servidor. Só depois do 2xx o registro vai para a store local, com a `version` da resposta; antes disso ele vive
 * na outbox. Um 400 `validation` vira rascunho recusado da `entity`, para o formulário reabrir com os erros por campo.
 * Um `version-conflict` (409 ou 412) passa pelo `settleConflict`; `deleted` vira rascunho em conflito e sai da fila
 * sem laço. Uma falha com `Retry-After` só volta para a fila depois dele.
 */
export function upsertMutation<T extends SyncRecord>({
  store,
  drafts,
  entity,
  send,
  strategy = flatMerge,
}: {
  store: LocalCollection<T>;
  drafts: DraftsCollection;
  entity: string;
  send: UpsertCall<T>;
  strategy?: MergeStrategy<T>;
}): OutboxMutationFn<T> {
  return async ({ transaction, idempotencyKey, requeue }) => {
    // Uma chave vale para um corpo só; enqueue nunca junta dois registros na mesma transação.
    const [mutation, ...rest] = transaction.mutations;
    if (!mutation || rest.length > 0) {
      throw new RejectedSyncError("bug", {
        kind: "unreadable",
        status: 0,
        body: `transação com ${transaction.mutations.length} mutações`,
      });
    }
    const { id, version: _local, ...body } = mutation.modified;
    const result = await send({
      path: { id },
      body,
      headers: outboxHeaders(idempotencyKey, (await confirmedOf(store, id))?.version),
    });
    if (!result.data) {
      const error = syncFailure({ error: result.error, response: result.response });
      if (error instanceof RejectedSyncError && error.group === "back-to-draft") {
        recordRejection(drafts, entity, mutation.modified, error.failure);
      }
      if (error instanceof RejectedSyncError && error.group === "user-decision") {
        const current = versionConflictCurrent(error.failure);
        const settled =
          current &&
          (await settleConflict({ store, drafts, entity, strategy, requeue }, mutation, current));
        if (settled) return;
        if (!current) {
          recordConflict(drafts, entity, mutation.modified, {
            current: currentOf(error.failure),
            collisions: [],
          });
        }
      }
      await waitRetryAfter(error);
      throw error;
    }
    await confirm(store, mutation, { ...mutation.modified, version: result.data.version });
    clearDraft(drafts, id);
    recordSyncSuccess();
  };
}

/**
 * Os passos 1 a 3 do conflito (frontend.md, "Conflito"). Devolve `true` quando a transação terminou sem a pessoa:
 *
 * 1. Era a própria escrita cuja resposta se perdeu: sucesso, com a `version` do `current`.
 * 2. Merge de três vias: base = a store confirmada (`serverShadow`), local = o mais novo do aparelho (o rascunho do
 *    formulário profundo ou a camada otimista, que tem a transação mais nova da fila) e servidor = o `current`.
 * 3. Sem colisão, o `current` vai para a store e o merge vira transação nova, com a `baseVersion` do `current` e chave
 *    nova. Ela é a mais nova da fila, então compacta as do mesmo registro que estavam atrás: elas levariam a versão
 *    nova sem o que veio do servidor. Merge igual ao servidor não sai: o `PUT` só criaria uma versão (ADR 0028).
 *
 * Com colisão, o rascunho fica em conflito com o local, o `current`, a base e as colisões, e não reenvia.
 */
async function settleConflict<T extends SyncRecord>(
  {
    store,
    drafts,
    entity,
    strategy,
    requeue,
  }: {
    store: LocalCollection<T>;
    drafts: DraftsCollection;
    entity: string;
    strategy: MergeStrategy<T>;
    requeue?: (mutate: () => void) => void;
  },
  mutation: PendingMutation<T>,
  current: Record<string, unknown>,
): Promise<boolean> {
  const sent = mutation.modified;
  const { id } = sent;
  if (isOwnWrite(current, sent)) {
    await confirm(store, mutation, { ...sent, version: String(current.version) });
    clearDraft(drafts, id);
    recordSyncSuccess();
    return true;
  }
  const base = await confirmedOf(store, id);
  const working = workingCopy(drafts, id);
  // A linha otimista leva as props virtuais do TanStack DB (`$synced` e afins): a forma do registro as tira.
  const newest = working ? { ...working, version: sent.version } : store.get(id);
  const local = newest ? strategy.shape(newest as Record<string, unknown>, sent) : sent;
  const server = strategy.shape(current, local);
  const { merged, collisions } = strategy.merge(base, local, server);
  if (collisions.length > 0 || !requeue) {
    recordConflict(drafts, entity, local, { current, base, collisions });
    return false;
  }
  await confirm(store, mutation, server);
  const { version: _version, ...values } = merged;
  rebaseDraft(drafts, id, values);
  if (sameValue(merged, server)) {
    recordSyncSuccess();
    return true;
  }
  requeue(() => {
    if (store.has(id)) {
      store.update(id, (draft) => {
        Object.assign(draft, merged);
      });
    } else {
      store.insert(merged);
    }
  });
  return true;
}
