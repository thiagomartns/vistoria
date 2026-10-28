import { type InspectionDto, upsertInspection } from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { type DraftsCollection, clearDraft, saveDraftValues } from "@/shared/sync/drafts";
import { type Outbox, type OutboxMutationFn, enqueue } from "@/shared/sync/outbox";
import { registerRecordLabel } from "@/shared/sync/sync-view";
import { type MergeStrategy, upsertMutation } from "@/shared/sync/upsert";

import { INSPECTION_ENTITY, type InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { inspectionRecordOf } from "./inspections.mappers";
import { mergeInspection } from "./inspections.merge";

export const UPSERT_INSPECTION = "upsertInspection";

registerRecordLabel(UPSERT_INSPECTION, (record) => {
  const rooms = Array.isArray(record.rooms) ? record.rooms.length : 0;
  return `Vistoria · ${rooms} ${rooms === 1 ? "ambiente" : "ambientes"}`;
});

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
 * Cria ou edita uma vistoria: aplica na hora e enfileira o `PUT` do agregado. A edição mantém a `version` do registro
 * (a do envio sai da store, na hora do envio); salvar de novo tira a recusa do rascunho, que fica com o passo da tela de
 * campo (ADR 0036). Devolve o id.
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
 * "Formulários profundos"): fechar a aba no meio de um ambiente não perde nada, nem o lugar.
 */
export function saveInspectionDraft(
  drafts: DraftsCollection,
  values: Omit<InspectionRecord, "version">,
  step: number,
): void {
  saveDraftValues(drafts, INSPECTION_ENTITY, values.id, values, step);
}
