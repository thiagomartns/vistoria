import { type ClientDto, getClient, syncClients, upsertClient } from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { type DraftsCollection, clearDraft, keepConflictData } from "@/shared/sync/drafts";
import { type FetchOutcome, fetchMissing } from "@/shared/sync/fetch";
import { flatConflictOf } from "@/shared/sync/flat-conflict";
import { newId } from "@/shared/sync/ids";
import { type Outbox, type OutboxMutationFn, enqueue } from "@/shared/sync/outbox";
import { type CursorsCollection, type PullEntity, pulledOnce } from "@/shared/sync/pull";
import { registerConflictView, registerRecordLabel } from "@/shared/sync/sync-view";
import { resolveConflict, upsertMutation } from "@/shared/sync/upsert";

import { CLIENT_ENTITY, type ClientRecord } from "../models/client";
import type { ClientsCollection } from "./clients.collection";

export const UPSERT_CLIENT = "upsertClient";
/** O laço de clientes no pull, que dá nome ao cursor e às marcas. */
export const CLIENTS_PULL = "clients";

const clientLabel = (record: Record<string, unknown>) => `Cliente · ${String(record.name ?? "")}`;

/** O ConflictResolver de um cliente. */
export const clientConflictHref = (id: string) => `/clients/conflict?id=${encodeURIComponent(id)}`;

registerRecordLabel(UPSERT_CLIENT, clientLabel);
registerConflictView(CLIENT_ENTITY, { title: clientLabel, href: clientConflictHref });

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
 * salvar de novo apaga o rascunho recusado. Com o rascunho em conflito, o que foi salvo fica só nele,
 * para o ConflictResolver (frontend.md, "Conflito"): enfileirar levaria a versão de antes do conflito. Devolve o id.
 */
export function saveClient(
  { clients, drafts, outbox }: { clients: ClientsCollection; drafts: DraftsCollection; outbox: Outbox },
  values: ClientValues & { id?: string },
): string {
  const id = values.id ?? newId();
  const record: ClientRecord = { ...values, id, version: clients.get(id)?.version ?? null };
  if (flatConflictOf(drafts.get(id))) {
    keepConflictData(drafts, id, record);
    return id;
  }
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

/**
 * Envia a resolução do ConflictResolver de um cliente (`resolveConflict`): o `current` vai para a store e o escolhido
 * vira transação nova, com chave nova e `If-Match` da `version` do `current`. O servidor reavalia tudo no reenvio
 * (CPF/CNPJ inclusive); uma recusa volta como rascunho recusado, com o erro no campo.
 */
export function resolveClientConflict(
  {
    clients,
    drafts,
    outbox,
  }: { clients: ClientsCollection; drafts: DraftsCollection; outbox: Outbox },
  { resolved, server }: { resolved: ClientRecord; server: ClientRecord },
): Promise<void> {
  return resolveConflict({
    store: clients,
    drafts,
    outbox,
    mutationFnName: UPSERT_CLIENT,
    server,
    resolved,
  });
}

/** Do DTO do servidor para o registro local: fica o que vai no `PUT` e a `version`; as datas são do servidor. */
export function clientRecordOf(dto: ClientDto): ClientRecord {
  return {
    id: dto.id,
    version: dto.version,
    name: dto.name,
    document: dto.document,
    email: dto.email,
    phone: dto.phone,
  };
}

/**
 * Abre pelo id um cliente que não está no aparelho (`fetchMissing`): `GET /api/v1/clients/{id}` e a resposta na store
 * confirmada. O que já está no aparelho, confirmado, na fila ou em rascunho, não é pedido, nem o que falta depois do
 * primeiro pull completo de clientes (`cursors`).
 */
export function fetchClient(
  {
    clients,
    drafts,
    cursors,
  }: { clients: ClientsCollection; drafts: DraftsCollection; cursors?: CursorsCollection },
  id: string,
  client?: Client,
): Promise<FetchOutcome> {
  return fetchMissing({
    store: clients,
    drafts,
    id,
    get: (request) => getClient({ client, ...request }),
    shape: clientRecordOf,
    synced: () => cursors !== undefined && pulledOnce(cursors, CLIENTS_PULL),
  });
}

/** O laço de clientes do pull (`syncClients`): a página na store confirmada, menos o que tem pendência (ADR 0041). */
export function clientsPull(clients: ClientsCollection, client?: Client): PullEntity<ClientRecord, ClientDto> {
  return {
    name: CLIENTS_PULL,
    store: clients,
    page: (request) => syncClients({ client, ...request }),
    get: (request) => getClient({ client, ...request }),
    shape: clientRecordOf,
  };
}
