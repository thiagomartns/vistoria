import type { PendingMutation } from "@tanstack/db";

import { type DraftsCollection, recordConflict } from "./drafts";
import {
  type Outbox,
  type OutboxMutationFn,
  RejectedSyncError,
  enqueue,
  outboxHeaders,
  syncFailure,
  waitRetryAfter,
} from "./outbox";
import { recordSyncSuccess } from "./sync-status";
import {
  type LocalCollection,
  type MergeStrategy,
  type SyncRecord,
  adoptServer,
  confirmedOf,
  dropConfirmed,
  versionConflictCurrent,
} from "./upsert";

// A exclusão de um registro pela outbox (frontend.md, "Escrita (push)"; ADR 0039), a contraparte do `upsert.ts`. Ela
// entra na fila única atrás do que já estava lá, e o `DELETE` só se decide no envio, pela store confirmada: o que o
// servidor nunca aceitou sai do aparelho sem requisição. Até o 204, o registro fica com `deleting` na camada otimista,
// e a tela o mostra "Excluindo", só leitura. Um `DELETE` num registro alterado em outro aparelho pede a pessoa
// ("Excluir mesmo assim?", ADR 0040).

/** A chamada gerada do `DELETE /api/v1/<entidade>/{id}`. */
export type DeleteCall = (request: {
  path: { id: string };
  headers: ReturnType<typeof outboxHeaders>;
}) => Promise<{ error?: unknown; response?: Response }>;

/** Tira o registro da store confirmada, pela mutação da transação. */
async function forget<T extends SyncRecord>(
  store: LocalCollection<T>,
  mutation: PendingMutation<T>,
): Promise<void> {
  // Na 0.15, acceptMutations tipa as mutações como Record<string, unknown>, não pelo item da collection.
  await store.utils.acceptMutations({
    mutations: [{ ...mutation, type: "delete" }],
  } as unknown as { mutations: PendingMutation[] });
}

/**
 * Envia a exclusão. Com o registro na store confirmada, `DELETE` com `If-Match` da versão dela e a chave da transação;
 * o 204 vale também para o que já tinha sumido. Sem ele (criado no aparelho e nunca aceito), não há o que excluir no
 * servidor. Nos dois casos, o registro e o rascunho saem do aparelho. Uma recusa sai da fila pelo `syncFailure` e desfaz
 * o `deleting`. No `version-conflict` (frontend.md, "Conflito", passo 5), o `current` já vai para a store confirmada,
 * para a tela mostrar o que mudou, e o rascunho fica em conflito `removal`: a pessoa decide se exclui mesmo assim
 * (`enqueueRemoval` de novo, com a versão nova e chave nova) ou fica com o servidor (`keepServer`). A reação ao
 * `locked` é do M5.
 */
export function removeMutation<T extends SyncRecord>({
  store,
  drafts,
  entity,
  shape,
  send,
}: {
  store: LocalCollection<T>;
  drafts: DraftsCollection;
  entity: string;
  /** O `current` do servidor na forma do registro local (o mesmo do merge). */
  shape: MergeStrategy<T>["shape"];
  send: DeleteCall;
}): OutboxMutationFn<T> {
  return async ({ transaction, idempotencyKey }) => {
    const [mutation, ...rest] = transaction.mutations;
    if (!mutation || rest.length > 0) {
      throw new RejectedSyncError("bug", {
        kind: "unreadable",
        status: 0,
        body: `transação com ${transaction.mutations.length} mutações`,
      });
    }
    const { id } = mutation.modified;
    const confirmed = await confirmedOf(store, id);
    if (confirmed) {
      const result = await send({
        path: { id },
        headers: outboxHeaders(idempotencyKey, confirmed.version),
      });
      if (result.error !== undefined || !result.response?.ok) {
        const error = syncFailure({ error: result.error, response: result.response });
        const current =
          error instanceof RejectedSyncError && error.group === "user-decision"
            ? versionConflictCurrent(error.failure)
            : undefined;
        if (current) {
          const { deleting: _deleting, ...like } = mutation.modified;
          const server = shape(current, like as T);
          await adoptServer(store, server);
          recordConflict(drafts, entity, server, { type: "removal", current, collisions: [] });
        }
        await waitRetryAfter(error);
        throw error;
      }
      await forget(store, mutation);
      recordSyncSuccess();
    }
    if (drafts.has(id)) drafts.delete(id);
  };
}

/**
 * Põe a exclusão na fila e apaga o rascunho: o que não foi enviado é descartado (o Dialog avisa). O registro que o
 * servidor já tem fica, marcado com `deleting`, até o 204: um conflito no `DELETE` o encontra onde ele estava. O que só
 * existe no aparelho sai da tela na hora, porque nada pode conflitar; o `DELETE` decide no envio que não há requisição.
 * O que nem está na collection (uma criação recusada, só no rascunho) não passa pela fila.
 */
export async function enqueueRemoval<T extends SyncRecord>({
  store,
  drafts,
  outbox,
  mutationFnName,
  id,
}: {
  store: LocalCollection<T> & { delete: (id: string) => unknown };
  drafts: DraftsCollection;
  outbox: Outbox;
  mutationFnName: string;
  id: string;
}): Promise<void> {
  const confirmed = await confirmedOf(store, id);
  if (drafts.has(id)) drafts.delete(id);
  if (!store.has(id) || store.get(id)?.deleting) return;
  enqueue(outbox, mutationFnName, () => {
    if (confirmed) {
      store.update(id, (draft) => {
        draft.deleting = true;
      });
    } else {
      store.delete(id);
    }
  });
}

/**
 * "Cancelar" no "Excluir mesmo assim?": a exclusão já saiu da fila e o `current` já está na store confirmada, então só
 * o conflito sai, e o registro volta a ser editável.
 */
export function keepServer(drafts: DraftsCollection, id: string): void {
  if (drafts.has(id)) drafts.delete(id);
}

/**
 * "Descartar alterações" num registro excluído em outro aparelho: ele sai da store confirmada e o rascunho é apagado,
 * sem requisição e sem fila (o servidor já não o tem).
 */
export async function discardDeleted<T extends SyncRecord>({
  store,
  drafts,
  id,
}: {
  store: LocalCollection<T>;
  drafts: DraftsCollection;
  id: string;
}): Promise<void> {
  await dropConfirmed(store, id);
  if (drafts.has(id)) drafts.delete(id);
}
