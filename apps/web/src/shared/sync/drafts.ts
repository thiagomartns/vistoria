import { type IndexedDBInstance, createCollection, indexedDBCollectionOptions } from "@tanstack/db";

import type { ApiFailure } from "../api/problems";

// Rascunhos no banco local (frontend.md, "Formulários profundos"). Com `rejected` e `conflict`, a transação que o
// servidor recusou sai da fila e desfaz o otimista, e o que foi enviado fica aqui. Com `validation`, junto com os erros
// por campo, para o formulário reabrir com eles; com `version-conflict` ou `deleted`, junto com o `current` do servidor,
// a base do merge do ConflictResolver (M3). Um rascunho por registro, com o id do registro.
// O formulário profundo (a vistoria) tem também o status `draft`: o rascunho guarda o passo e os valores a cada
// mudança, e fica até concluir (ADR 0036). Recusa e conflito mudam só o status dele: os valores e o passo são os mais
// novos que a pessoa marcou. `pending` e o DraftResume ficam para depois.

export interface DraftRecord {
  /** O id do registro que o rascunho edita. */
  id: string;
  /** A entidade do registro ("client"). */
  entity: string;
  /** O registro como foi enviado; no formulário profundo, como a pessoa deixou. */
  data: Record<string, unknown>;
  status: "draft" | "rejected" | "conflict";
  /** Só no formulário profundo: a etapa atual (o índice do ambiente). */
  step?: number;
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

/** O rascunho do formulário profundo, que guarda o passo e fica até concluir. */
const keepsStep = (draft: DraftRecord | undefined): draft is DraftRecord & { step: number } =>
  draft?.step !== undefined;

function save(drafts: DraftsCollection, draft: DraftRecord): void {
  if (drafts.has(draft.id)) {
    drafts.update(draft.id, (current) => {
      // No formulário profundo, o rascunho já tem o que a pessoa marcou depois do envio recusado.
      const kept = keepsStep(current) ? { data: current.data, step: current.step } : {};
      delete current.conflict;
      Object.assign(current, draft, kept);
    });
  } else {
    drafts.insert(draft);
  }
}

/**
 * Grava os valores e o passo do formulário profundo a cada mudança. Mantém o status e os erros: uma recusa continua
 * à vista até o formulário ir de novo para a fila.
 */
export function saveDraftValues(
  drafts: DraftsCollection,
  entity: string,
  id: string,
  data: Record<string, unknown>,
  step: number,
  now: Date = new Date(),
): void {
  const updatedAt = now.toISOString();
  if (drafts.has(id)) {
    drafts.update(id, (current) => {
      Object.assign(current, { data, step, updatedAt });
    });
  } else {
    drafts.insert({ id, entity, data, status: "draft", errors: {}, step, updatedAt });
  }
}

/**
 * O registro foi salvo de novo ou o servidor aceitou: apaga o rascunho. O do formulário profundo fica, como `draft`,
 * sem os erros e o conflito, porque guarda o passo (ADR 0036).
 */
export function clearDraft(drafts: DraftsCollection, id: string): void {
  const draft = drafts.get(id);
  if (!draft) return;
  if (!keepsStep(draft)) {
    drafts.delete(id);
  } else if (draft.status !== "draft") {
    drafts.update(id, (current) => {
      delete current.conflict;
      Object.assign(current, { status: "draft", errors: {} });
    });
  }
}

/** O rascunho pede uma ação da pessoa (recusado ou em conflito): na lista, ele vence o registro. */
export const needsAction = (draft: DraftRecord | undefined): draft is DraftRecord =>
  draft !== undefined && draft.status !== "draft";

/** O SyncBadge de um registro com rascunho: em conflito ou recusado. */
export type DraftSyncState = "conflito" | "rejeitado";

export const draftSyncState = (draft: DraftRecord): DraftSyncState =>
  draft.status === "conflict" ? "conflito" : "rejeitado";
