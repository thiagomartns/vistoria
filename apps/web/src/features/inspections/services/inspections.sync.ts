import {
  type InspectionDto,
  deleteInspection as sendDelete,
  getInspection,
  upsertInspection,
} from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { type DraftsCollection, clearDraft, saveDraftValues } from "@/shared/sync/drafts";
import { type FetchOutcome, fetchMissing } from "@/shared/sync/fetch";
import { type Outbox, type OutboxMutationFn, enqueue } from "@/shared/sync/outbox";
import { discardDeleted, enqueueRemoval, keepServer, removeMutation } from "@/shared/sync/remove";
import { registerConflictView, registerRecordLabel } from "@/shared/sync/sync-view";
import { type MergeStrategy, resolveConflict, upsertMutation } from "@/shared/sync/upsert";

import type { ClientsCollection } from "@/features/clients/services/clients.collection";
import type { PropertiesCollection } from "@/features/properties/services/properties.collection";
import { fetchProperty } from "@/features/properties/services/properties.sync";

import { INSPECTION_ENTITY, type InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { inspectionRecordOf } from "./inspections.mappers";
import { mergeInspection } from "./inspections.merge";
import { conflictHref, recreatedInspection } from "./inspections.resolve";

export const UPSERT_INSPECTION = "upsertInspection";
export const DELETE_INSPECTION = "deleteInspection";

/** "Vistoria · 7 ambientes", no OutboxPanel. */
function inspectionLabel(record: Record<string, unknown>): string {
  const rooms = Array.isArray(record.rooms) ? record.rooms.length : 0;
  return `Vistoria · ${rooms} ${rooms === 1 ? "ambiente" : "ambientes"}`;
}

registerRecordLabel(UPSERT_INSPECTION, inspectionLabel);
registerRecordLabel(
  DELETE_INSPECTION,
  (record) => `Excluir ${inspectionLabel(record).toLowerCase()}`,
);
registerConflictView(INSPECTION_ENTITY, { title: inspectionLabel, href: conflictHref });

/** No conflito, o agregado se mescla por ambiente e item (#103), com o `current` na forma do registro. */
const inspectionMerge: MergeStrategy<InspectionRecord> = {
  shape: (current) => inspectionRecordOf(current as unknown as InspectionDto),
  merge: mergeInspection,
};

/**
 * Envia a transação como `PUT /api/v1/inspections/{id}` (`upsertMutation`), com o agregado inteiro: a lista de
 * ambientes e itens é completa, e o que não vier o servidor exclui. A outbox é serial (ADR 0034): uma vistoria de um
 * imóvel ainda pendente só sai depois dele; se o imóvel for recusado, ela volta com `propertyId` "Imóvel não
 * encontrado." e vira rascunho recusado, como qualquer `validation` (os erros de ambiente e item chegam no caminho do
 * servidor, `rooms[0].items[1].condition`, e ficam assim no rascunho).
 */
export function upsertInspectionMutation(
  inspections: InspectionsCollection,
  drafts: DraftsCollection,
  client?: Client,
): OutboxMutationFn<InspectionRecord> {
  return upsertMutation<InspectionRecord>({
    store: inspections,
    drafts,
    entity: INSPECTION_ENTITY,
    send: (request) => upsertInspection({ client, ...request }),
    strategy: inspectionMerge,
  });
}

/**
 * Envia a exclusão como `DELETE /api/v1/inspections/{id}` (`removeMutation`), com `If-Match` da versão confirmada; a
 * vistoria que o servidor nunca aceitou sai do aparelho sem requisição (ADR 0039). Alterada em outro aparelho, ela
 * fica com o `current` e pede "Excluir mesmo assim?" (ADR 0040).
 */
export function deleteInspectionMutation(
  inspections: InspectionsCollection,
  drafts: DraftsCollection,
  client?: Client,
): OutboxMutationFn<InspectionRecord> {
  return removeMutation<InspectionRecord>({
    store: inspections,
    drafts,
    entity: INSPECTION_ENTITY,
    shape: inspectionMerge.shape,
    send: (request) => sendDelete({ client, ...request }),
  });
}

/** A exclusão da vistoria está na fila: nada mais dela vai para a fila nem para o rascunho. */
const leaving = (inspections: InspectionsCollection, id: string) =>
  inspections.get(id)?.deleting === true;

/**
 * Exclui uma vistoria em andamento: põe o `DELETE` na fila e descarta o rascunho (`enqueueRemoval`). Até o 204, ela
 * fica na lista como "Excluindo" e a tela de campo, só leitura; a que só existe no aparelho some na hora.
 */
export function deleteInspection(
  {
    inspections,
    drafts,
    outbox,
  }: { inspections: InspectionsCollection; drafts: DraftsCollection; outbox: Outbox },
  id: string,
): Promise<void> {
  return enqueueRemoval({
    store: inspections,
    drafts,
    outbox,
    mutationFnName: DELETE_INSPECTION,
    id,
  });
}

/**
 * Cria ou edita uma vistoria: aplica na hora e enfileira o `PUT` do agregado. A edição mantém a `version` do registro
 * (a do envio sai da store, na hora do envio); salvar de novo tira a recusa do rascunho, que fica com o passo da tela de
 * campo (ADR 0036). Com a exclusão na fila, não faz nada: o `PUT` sairia depois do `DELETE`. Devolve o id.
 */
export function saveInspection(
  {
    inspections,
    drafts,
    outbox,
  }: { inspections: InspectionsCollection; drafts: DraftsCollection; outbox: Outbox },
  values: Omit<InspectionRecord, "version">,
): string {
  const { id } = values;
  if (leaving(inspections, id)) return id;
  const record: InspectionRecord = { ...values, version: inspections.get(id)?.version ?? null };
  enqueue(outbox, UPSERT_INSPECTION, () => {
    if (inspections.has(id)) {
      inspections.update(id, (draft) => {
        Object.assign(draft, record);
      });
    } else {
      inspections.insert(record);
    }
  });
  clearDraft(drafts, id);
  return id;
}

/**
 * Guarda no rascunho a vistoria como está na tela de campo e o ambiente aberto, a cada mudança (frontend.md,
 * "Formulários profundos"): fechar a aba no meio de um ambiente não perde nada, nem o lugar. Com a exclusão na fila,
 * não guarda: o rascunho foi descartado com ela.
 */
export function saveInspectionDraft(
  { inspections, drafts }: { inspections: InspectionsCollection; drafts: DraftsCollection },
  values: Omit<InspectionRecord, "version">,
  step: number,
): void {
  if (leaving(inspections, values.id)) return;
  saveDraftValues(drafts, INSPECTION_ENTITY, values.id, values, step);
}

/**
 * Envia a resolução de um conflito (ConflictResolver): o `current` vai para a store, e a vistoria escolhida sai numa
 * transação nova, com chave nova e a `version` do `current` no `If-Match`. Tudo do servidor só adota o `current`.
 */
export function resolveInspectionConflict(
  {
    inspections,
    drafts,
    outbox,
  }: { inspections: InspectionsCollection; drafts: DraftsCollection; outbox: Outbox },
  { resolved, server }: { resolved: InspectionRecord; server: InspectionRecord },
): Promise<void> {
  return resolveConflict({
    store: inspections,
    drafts,
    outbox,
    mutationFnName: UPSERT_INSPECTION,
    server,
    resolved,
  });
}

type InspectionStore = {
  inspections: InspectionsCollection;
  drafts: DraftsCollection;
  outbox: Outbox;
};

/**
 * "Recriar vistoria" (ConflictResolver tipo excluído, ADR 0040): a vistoria do rascunho, o mais novo do aparelho, volta
 * como vistoria nova, com ids novos na raiz, nos ambientes e nos itens, num `PUT` sem `If-Match`. O rascunho com o passo
 * passa para ela, e a excluída sai do aparelho. Devolve o id novo.
 */
export async function recreateInspection(store: InspectionStore, id: string): Promise<string> {
  const draft = store.drafts.get(id);
  const local = (draft?.data ?? store.inspections.get(id)) as InspectionRecord | undefined;
  if (!local) return id;
  const { version: _version, ...values } = recreatedInspection(local);
  saveInspection(store, values);
  if (draft?.step !== undefined) {
    saveDraftValues(store.drafts, INSPECTION_ENTITY, values.id, values, draft.step);
  }
  await discardDeleted({ store: store.inspections, drafts: store.drafts, id });
  return values.id;
}

/** "Descartar alterações" (tipo excluído): a vistoria e o rascunho saem do aparelho, sem requisição. */
export function discardDeletedInspection(
  { inspections, drafts }: Pick<InspectionStore, "inspections" | "drafts">,
  id: string,
): Promise<void> {
  return discardDeleted({ store: inspections, drafts, id });
}

/**
 * "Cancelar" no "Excluir mesmo assim?" (tipo exclusão alterada): a exclusão já saiu da fila e a vistoria já está como
 * o servidor a tem; só o conflito sai, e ela volta a ser editável.
 */
export function keepInspection({ drafts }: Pick<InspectionStore, "drafts">, id: string): void {
  keepServer(drafts, id);
}

/**
 * Abre pelo id uma vistoria que não está no aparelho (frontend.md, "Leitura (pull)"; ADR 0038):
 * `GET /api/v1/inspections/{id}` e o agregado na store confirmada, com a `version`. Antes de gravá-la, o imóvel dela e
 * o cliente do imóvel, se faltarem, para a tela de campo abrir com o endereço. Uma vistoria com pendência (na fila ou
 * em rascunho) nunca é pedida nem sobrescrita.
 */
export function fetchInspection(
  store: {
    inspections: InspectionsCollection;
    properties: PropertiesCollection;
    clients: ClientsCollection;
    drafts: DraftsCollection;
  },
  id: string,
  client?: Client,
): Promise<FetchOutcome> {
  return fetchMissing({
    store: store.inspections,
    drafts: store.drafts,
    id,
    get: (request) => getInspection({ client, ...request }),
    shape: inspectionRecordOf,
    before: (inspection) => fetchProperty(store, inspection.propertyId, client),
  });
}
