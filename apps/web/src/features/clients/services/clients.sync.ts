import { upsertClient } from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { type DraftsCollection, clearDraft } from "@/shared/sync/drafts";
import { newId } from "@/shared/sync/ids";
import { type Outbox, type OutboxMutationFn, enqueue } from "@/shared/sync/outbox";
import { registerRecordLabel } from "@/shared/sync/sync-view";
import { upsertMutation } from "@/shared/sync/upsert";

import { CLIENT_ENTITY, type ClientRecord } from "../models/client";
import type { ClientsCollection } from "./clients.collection";

export const UPSERT_CLIENT = "upsertClient";

registerRecordLabel(UPSERT_CLIENT, (record) => `Cliente · ${String(record.name ?? "")}`);

/**
 * Envia a transação como `PUT /api/v1/clients/{id}` (`upsertMutation`): `If-Match` quando o registro já está no
 * servidor, a store só depois do 2xx e o 400 `validation` como rascunho recusado de client.
 */
export function upsertClientMutation(
  clients: ClientsCollection,
  drafts: DraftsCollection,
  client?: Client,
): OutboxMutationFn<ClientRecord> {
  return upsertMutation<ClientRecord>({
    store: clients,
    drafts,
    entity: CLIENT_ENTITY,
    send: (request) => upsertClient({ client, ...request }),
  });
}

/** Os campos que o formulário edita. */
export type ClientValues = Omit<ClientRecord, "id" | "version">;

/**
 * Cria (sem `id`) ou edita um client: aplica na hora e enfileira o `PUT`. A edição mantém a `version` do registro;
 * salvar de novo apaga o rascunho recusado. Devolve o id.
 */
export function saveClient(
  { clients, drafts, outbox }: { clients: ClientsCollection; drafts: DraftsCollection; outbox: Outbox },
  values: ClientValues & { id?: string },
): string {
  const id = values.id ?? newId();
  const record: ClientRecord = { ...values, id, version: clients.get(id)?.version ?? null };
  enqueue(outbox, UPSERT_CLIENT, () => {
    if (clients.has(id)) {
      clients.update(id, (draft) => {
        Object.assign(draft, record);
      });
    } else {
      clients.insert(record);
    }
  });
  clearDraft(drafts, id);
  return id;
}
