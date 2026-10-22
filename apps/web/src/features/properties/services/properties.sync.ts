import { upsertProperty } from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { type DraftsCollection, clearDraft } from "@/shared/sync/drafts";
import { newId } from "@/shared/sync/ids";
import { type Outbox, type OutboxMutationFn, enqueue } from "@/shared/sync/outbox";
import { registerRecordLabel } from "@/shared/sync/sync-view";
import { upsertMutation } from "@/shared/sync/upsert";

import { PROPERTY_ENTITY, type PropertyRecord } from "../models/property";
import type { PropertiesCollection } from "./properties.collection";
import { addressOf } from "./properties.view";

export const UPSERT_PROPERTY = "upsertProperty";

registerRecordLabel(UPSERT_PROPERTY, (record) => `Imóvel · ${addressOf(record)}`);

/**
 * Envia a transação como `PUT /api/v1/properties/{id}` (`upsertMutation`). A outbox é serial (ADR 0034): um imóvel
 * criado com um cliente ainda pendente só sai depois dele. Se o cliente for recusado, o imóvel volta com
 * `clientId` "Cliente não encontrado." e vira rascunho recusado, como qualquer `validation`.
 */
export function upsertPropertyMutation(
  properties: PropertiesCollection,
  drafts: DraftsCollection,
  client?: Client,
): OutboxMutationFn<PropertyRecord> {
  return upsertMutation<PropertyRecord>({
    store: properties,
    drafts,
    entity: PROPERTY_ENTITY,
    send: (request) => upsertProperty({ client, ...request }),
  });
}

/** Os campos que o formulário edita. */
export type PropertyValues = Omit<PropertyRecord, "id" | "version">;

/**
 * Cria (sem `id`) ou edita um imóvel: aplica na hora e enfileira o `PUT`. A edição mantém a `version` do registro;
 * salvar de novo apaga o rascunho recusado. Devolve o id.
 */
export function saveProperty(
  {
    properties,
    drafts,
    outbox,
  }: { properties: PropertiesCollection; drafts: DraftsCollection; outbox: Outbox },
  values: PropertyValues & { id?: string },
): string {
  const id = values.id ?? newId();
  const record: PropertyRecord = { ...values, id, version: properties.get(id)?.version ?? null };
  enqueue(outbox, UPSERT_PROPERTY, () => {
    if (properties.has(id)) {
      properties.update(id, (draft) => {
        Object.assign(draft, record);
      });
    } else {
      properties.insert(record);
    }
  });
  clearDraft(drafts, id);
  return id;
}
