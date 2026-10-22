import type { PendingMutation } from "@tanstack/db";

import { type DraftsCollection, clearDraft, recordConflict, recordRejection } from "./drafts";
import {
  type OutboxMutationFn,
  RejectedSyncError,
  outboxHeaders,
  syncFailure,
  waitRetryAfter,
} from "./outbox";
import { recordSyncSuccess } from "./sync-status";

// O envio de um registro pelo `PUT` de upsert (ADR 0028), igual em toda entidade: a feature só diz qual chamada do
// client gerado faz o `PUT`.

/** Um registro no banco local: o corpo do `PUT`, o `id` gerado no aparelho e a `version` que o servidor confirmou. */
export type SyncRecord = { id: string; version: string | null };

/** A store onde o registro vai depois do 2xx (as `utils` de uma collection IndexedDB). */
export interface ConfirmedStore<T> {
  utils: {
    exportData: () => Promise<T[]>;
    acceptMutations: (transaction: { mutations: PendingMutation[] }) => Promise<void>;
  };
}

/** A chamada gerada do `PUT /api/v1/<entidade>/{id}`. */
export type UpsertCall<T extends SyncRecord> = (request: {
  path: { id: string };
  body: Omit<T, "id" | "version">;
  headers: ReturnType<typeof outboxHeaders>;
}) => Promise<{ data?: { version: string }; error?: unknown; response?: Response }>;

/**
 * A versão-base do envio: a `version` que o servidor confirmou por último para o registro, lida da store na hora do
 * envio (e não da transação). Assim duas edições seguidas saem encadeadas: a segunda leva a versão que a primeira
 * devolveu. Vale porque a store só recebe o que o servidor confirmou; o pull do M4 não pode sobrescrever registro
 * com pendência (frontend.md, "Leitura").
 */
async function baseVersionOf<T extends SyncRecord>(
  store: ConfirmedStore<T>,
  id: string,
): Promise<string | null> {
  const stored = (await store.utils.exportData()).find((record) => record.id === id);
  return stored?.version ?? null;
}

/**
 * Envia a transação pelo `PUT` com o registro completo, a chave da transação e `If-Match` quando o registro já está
 * no servidor. Só depois do 2xx o registro vai para a store local, com a `version` da resposta; antes disso ele vive
 * na outbox. Um 400 `validation` vira rascunho recusado da `entity`, para o formulário reabrir com os erros por campo;
 * um `version-conflict` (409 ou 412) ou `deleted` vira rascunho em conflito, com o `current`, e sai da fila sem laço.
 * Uma falha com `Retry-After` só volta para a fila depois dele.
 */
export function upsertMutation<T extends SyncRecord>({
  store,
  drafts,
  entity,
  send,
}: {
  store: ConfirmedStore<T>;
  drafts: DraftsCollection;
  entity: string;
  send: UpsertCall<T>;
}): OutboxMutationFn<T> {
  return async ({ transaction, idempotencyKey }) => {
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
      headers: outboxHeaders(idempotencyKey, await baseVersionOf(store, id)),
    });
    if (!result.data) {
      const error = syncFailure({ error: result.error, response: result.response });
      if (error instanceof RejectedSyncError && error.group === "back-to-draft") {
        recordRejection(drafts, entity, mutation.modified, error.failure);
      }
      if (error instanceof RejectedSyncError && error.group === "user-decision") {
        recordConflict(drafts, entity, mutation.modified, error.failure);
      }
      await waitRetryAfter(error);
      throw error;
    }
    const confirmed = { ...mutation, modified: { ...mutation.modified, version: result.data.version } };
    // Na 0.14, acceptMutations tipa as mutações como Record<string, unknown>, não pelo item da collection.
    await store.utils.acceptMutations({ mutations: [confirmed] } as unknown as {
      mutations: PendingMutation[];
    });
    clearDraft(drafts, id);
    recordSyncSuccess();
  };
}
