import { type IndexedDBInstance, createCollection, indexedDBCollectionOptions } from "@tanstack/db";

import type { ApiFailure } from "../api/problems";

// Rascunhos no banco local (frontend.md, "Formulários profundos"). Por ora, os status `rejected` e `conflict`: a
// transação que o servidor recusou sai da fila e desfaz o otimista, e o que foi enviado fica aqui. Com `validation`,
// junto com os erros por campo, para o formulário reabrir com eles; com `version-conflict` ou `deleted`, junto com o
// `current` do servidor, a base do merge do ConflictResolver (M3). Um rascunho por registro, com o id do registro.
// `draft`, `pending` e o DraftResume chegam com a vistoria.

export interface DraftRecord {
  /** O id do registro que o rascunho edita. */
  id: string;
  /** A entidade do registro ("client"). */
  entity: string;
  /** O registro como foi enviado. */
  data: Record<string, unknown>;
  status: "rejected" | "conflict";
  /** Erros por campo, com as chaves do backend (`document`, `rooms[2].items[4].condition`). Vazio no conflito. */
  errors: Record<string, string[]>;
  /** Só no conflito: o registro como está no servidor (`current`; ausente em `deleted`). */
  conflict?: { current: unknown };
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

type SentRecord = { id: string } & Record<string, unknown>;

/** Guarda o registro recusado com os erros do `validation`. Substitui um rascunho anterior do mesmo registro. */
export function recordRejection(
  drafts: DraftsCollection,
  entity: string,
  record: SentRecord,
  failure: ApiFailure,
  now: Date = new Date(),
): void {
  save(drafts, {
    id: record.id,
    entity,
    data: record,
    status: "rejected",
    errors: failure.kind === "problem" ? (failure.problem.errors ?? {}) : {},
    updatedAt: now.toISOString(),
  });
}

/**
 * Marca o conflito (`version-conflict` ou `deleted`): guarda o registro enviado com o `current` do servidor. Não
 * reenvia: resolver é decisão da pessoa (ConflictResolver, M3). Substitui um rascunho anterior do mesmo registro.
 */
export function recordConflict(
  drafts: DraftsCollection,
  entity: string,
  record: SentRecord,
  failure: ApiFailure,
  now: Date = new Date(),
): void {
  save(drafts, {
    id: record.id,
    entity,
    data: record,
    status: "conflict",
    errors: {},
    conflict: { current: failure.kind === "problem" ? failure.problem.current : undefined },
    updatedAt: now.toISOString(),
  });
}

function save(drafts: DraftsCollection, draft: DraftRecord): void {
  if (drafts.has(draft.id)) {
    drafts.update(draft.id, (current) => {
      delete current.conflict;
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

/** O SyncBadge de um registro com rascunho: em conflito ou recusado. */
export type DraftSyncState = "conflito" | "rejeitado";

export const draftSyncState = (draft: DraftRecord): DraftSyncState =>
  draft.status === "conflict" ? "conflito" : "rejeitado";
