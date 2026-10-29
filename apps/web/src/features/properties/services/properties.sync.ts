import { type PropertyDto, getProperty, upsertProperty } from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { type DraftsCollection, clearDraft, keepConflictData } from "@/shared/sync/drafts";
import { type FetchOutcome, fetchMissing } from "@/shared/sync/fetch";
import { flatConflictOf } from "@/shared/sync/flat-conflict";
import { newId } from "@/shared/sync/ids";
import { type Outbox, type OutboxMutationFn, enqueue } from "@/shared/sync/outbox";
import { registerConflictView, registerRecordLabel } from "@/shared/sync/sync-view";
import { resolveConflict, upsertMutation } from "@/shared/sync/upsert";

import type { ClientsCollection } from "@/features/clients/services/clients.collection";
import { fetchClient } from "@/features/clients/services/clients.sync";

import { PROPERTY_ENTITY, type PropertyRecord } from "../models/property";
import type { PropertiesCollection } from "./properties.collection";
import { addressOf } from "./properties.view";

export const UPSERT_PROPERTY = "upsertProperty";

const propertyLabel = (record: Record<string, unknown>) => `Imóvel · ${addressOf(record)}`;

/** O ConflictResolver de um imóvel. */
export const propertyConflictHref = (id: string) => `/properties/conflict?id=${encodeURIComponent(id)}`;

registerRecordLabel(UPSERT_PROPERTY, propertyLabel);
registerConflictView(PROPERTY_ENTITY, { title: propertyLabel, href: propertyConflictHref });

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
 * salvar de novo apaga o rascunho recusado. Com o rascunho em conflito, o que foi salvo fica só nele,
 * para o ConflictResolver (frontend.md, "Conflito"): enfileirar levaria a versão de antes do conflito. Devolve o id.
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
  if (flatConflictOf(drafts.get(id))) {
    keepConflictData(drafts, id, record);
    return id;
  }
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

/**
 * Envia a resolução do ConflictResolver de um imóvel (`resolveConflict`): o `current` vai para a store e o escolhido
 * vira transação nova, com chave nova e `If-Match` da `version` do `current`. O servidor reavalia tudo no reenvio
 * (CPF/CNPJ inclusive); uma recusa volta como rascunho recusado, com o erro no campo.
 */
export function resolvePropertyConflict(
  {
    properties,
    drafts,
    outbox,
  }: { properties: PropertiesCollection; drafts: DraftsCollection; outbox: Outbox },
  { resolved, server }: { resolved: PropertyRecord; server: PropertyRecord },
): Promise<void> {
  return resolveConflict({
    store: properties,
    drafts,
    outbox,
    mutationFnName: UPSERT_PROPERTY,
    server,
    resolved,
  });
}

/** Do DTO do servidor para o registro local: fica o que vai no `PUT` e a `version`; as datas são do servidor. */
export function propertyRecordOf(dto: PropertyDto): PropertyRecord {
  return {
    id: dto.id,
    version: dto.version,
    clientId: dto.clientId,
    street: dto.street,
    number: dto.number,
    complement: dto.complement,
    district: dto.district,
    city: dto.city,
    state: dto.state,
    zipCode: dto.zipCode,
    type: dto.type,
    notes: dto.notes,
  };
}

/**
 * Abre pelo id um imóvel que não está no aparelho (`fetchMissing`): `GET /api/v1/properties/{id}`, e antes de gravá-lo
 * o cliente dele, se também faltar. Uma falha no cliente não segura o imóvel: o cliente é pedido de novo quando a
 * tela dele abrir.
 */
export function fetchProperty(
  store: { properties: PropertiesCollection; clients: ClientsCollection; drafts: DraftsCollection },
  id: string,
  client?: Client,
): Promise<FetchOutcome> {
  return fetchMissing({
    store: store.properties,
    drafts: store.drafts,
    id,
    get: (request) => getProperty({ client, ...request }),
    shape: propertyRecordOf,
    before: (property) => fetchClient(store, property.clientId, client),
  });
}
