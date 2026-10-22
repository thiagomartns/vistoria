import { type IndexedDBInstance, createCollection, indexedDBCollectionOptions } from "@tanstack/db";

import type { ApiFailure } from "../api/problems";

// Rascunhos no banco local (frontend.md, "Formulários profundos"). Por ora só o status `rejected`: a transação que o
// servidor recusou com `validation` sai da fila e desfaz o otimista, e o que foi enviado fica aqui com os erros por
// campo, para o formulário reabrir com eles. Um rascunho por registro, com o id do registro. `draft`, `pending`,
// `conflict` e o DraftResume chegam com a vistoria.

export interface DraftRecord {
  /** O id do registro que o rascunho edita. */
  id: string;
  /** A entidade do registro ("client"). */
  entity: string;
  /** O registro como foi enviado. */
  data: Record<string, unknown>;
  status: "rejected";
  /** Erros por campo, com as chaves do backend (`document`, `rooms[2].items[4].condition`). */
  errors: Record<string, string[]>;
  updatedAt: string;
}

export function createDraftsCollection(db: IndexedDBInstance) {
  return createCollection(
    indexedDBCollectionOptions<DraftRecord, string>({
      db,
      name: "drafts",
      getKey: (draft) => draft.id,
    }),
  );
}

export type DraftsCollection = ReturnType<typeof createDraftsCollection>;

/** Guarda o registro recusado com os erros do `validation`. Substitui um rascunho anterior do mesmo registro. */
export function recordRejection(
  drafts: DraftsCollection,
  entity: string,
  record: { id: string } & Record<string, unknown>,
  failure: ApiFailure,
  now: Date = new Date(),
): void {
  const draft: DraftRecord = {
    id: record.id,
    entity,
    data: record,
    status: "rejected",
    errors: failure.kind === "problem" ? (failure.problem.errors ?? {}) : {},
    updatedAt: now.toISOString(),
  };
  if (drafts.has(draft.id)) {
    drafts.update(draft.id, (current) => {
      Object.assign(current, draft);
    });
  } else {
    drafts.insert(draft);
  }
}

/** Apaga o rascunho do registro, se houver: ele foi salvo de novo ou o servidor aceitou. */
export function clearDraft(drafts: DraftsCollection, id: string): void {
  if (drafts.has(id)) drafts.delete(id);
}
