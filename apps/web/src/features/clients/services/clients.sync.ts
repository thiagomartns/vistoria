import type { PendingMutation } from "@tanstack/db";

import { upsertClient } from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { closeLocalDb, openLocalDb } from "@/shared/db/local-db";
import {
  type DraftsCollection,
  clearDraft,
  createDraftsCollection,
  recordRejection,
} from "@/shared/sync/drafts";
import { newId } from "@/shared/sync/ids";
import {
  type Outbox,
  type OutboxMutationFn,
  RejectedSyncError,
  enqueue,
  outboxHeaders,
  startOutbox,
  syncFailure,
} from "@/shared/sync/outbox";
import { recordSyncSuccess, trackOutbox } from "@/shared/sync/sync-status";
import { registerRecordLabel } from "@/shared/sync/sync-view";

import { CLIENT_ENTITY, type ClientRecord } from "../models/client";
import { type ClientsCollection, createClientsCollection } from "./clients.collection";

export const UPSERT_CLIENT = "upsertClient";

registerRecordLabel(UPSERT_CLIENT, (record) => `Cliente · ${String(record.name ?? "")}`);

/**
 * A versão-base do envio: a `version` que o servidor confirmou por último para o registro, lida da store na hora do
 * envio (e não da transação). Assim duas edições seguidas saem encadeadas: a segunda leva a versão que a primeira
 * devolveu. Vale porque a store só recebe o que o servidor confirmou; o pull do M4 não pode sobrescrever registro
 * com pendência (frontend.md, "Leitura").
 */
async function baseVersionOf(clients: ClientsCollection, id: string): Promise<string | null> {
  const stored = (await clients.utils.exportData()).find((client) => client.id === id);
  return stored?.version ?? null;
}

/**
 * Envia a transação como `PUT /api/v1/clients/{id}` com o registro completo, a chave da transação e `If-Match`
 * quando o registro já está no servidor. Só depois do 2xx o registro vai para a store local, com a `version` da
 * resposta; antes disso ele vive na outbox. Um 400 `validation` vira rascunho recusado, para o formulário reabrir
 * com os erros por campo.
 */
export function upsertClientMutation(
  clients: ClientsCollection,
  drafts: DraftsCollection,
  client?: Client,
): OutboxMutationFn<ClientRecord> {
  return async ({ transaction, idempotencyKey }) => {
    // Uma chave vale para um corpo só; enqueue nunca junta dois registros na mesma transação.
    const [mutation, ...rest] = transaction.mutations;
    if (!mutation || rest.length > 0) {
      throw new RejectedSyncError("bug", {
        kind: "unreadable",
        status: 0,
        body: `transação com ${transaction.mutations.length} mutações`,
      });
    }
    const { id, version: _local, ...body } = mutation.modified;
    const result = await upsertClient({
      client,
      path: { id },
      body,
      headers: outboxHeaders(idempotencyKey, await baseVersionOf(clients, id)),
    });
    if (!result.data) {
      const error = syncFailure(result);
      if (error instanceof RejectedSyncError && error.group === "back-to-draft") {
        recordRejection(drafts, CLIENT_ENTITY, mutation.modified, error.failure);
      }
      throw error;
    }
    const confirmed = { ...mutation, modified: { ...mutation.modified, version: result.data.version } };
    // Na 0.14, acceptMutations tipa as mutações como Record<string, unknown>, não pelo item da collection.
    await clients.utils.acceptMutations({ mutations: [confirmed] } as unknown as {
      mutations: PendingMutation[];
    });
    clearDraft(drafts, id);
    recordSyncSuccess();
  };
}

export interface ClientsStore {
  clients: ClientsCollection;
  drafts: DraftsCollection;
  outbox: Outbox;
}

let current: { ownerId: string; opening: Promise<ClientsStore> } | undefined;

async function open(ownerId: string): Promise<ClientsStore> {
  const db = await openLocalDb(ownerId);
  const clients = createClientsCollection(db);
  const drafts = createDraftsCollection(db);
  const outbox = startOutbox({
    ownerId,
    collections: { clients },
    mutationFns: { [UPSERT_CLIENT]: upsertClientMutation(clients, drafts) },
  });
  await outbox.waitForInit();
  trackOutbox(outbox);
  return { clients, drafts, outbox };
}

async function close(ownerId: string, opening: Promise<ClientsStore>): Promise<void> {
  const store = await opening.catch(() => undefined);
  store?.outbox.dispose();
  await store?.clients.cleanup();
  await store?.drafts.cleanup();
  await closeLocalDb(ownerId);
}

/**
 * Abre o banco local, a collection e a outbox do usuário uma vez por página (só no navegador). Trocar de usuário
 * fecha os do anterior: a fila dele fica guardada no banco dele, sem enviar, até ele entrar de novo.
 */
export function openClientsStore(ownerId: string): Promise<ClientsStore> {
  if (current?.ownerId === ownerId) return current.opening;
  const previous = current;
  const opening = (async () => {
    if (previous) await close(previous.ownerId, previous.opening);
    return open(ownerId);
  })();
  current = { ownerId, opening };
  return opening;
}

/** Fecha o que estiver aberto. Só para testes. */
export async function closeClientsStore(): Promise<void> {
  const previous = current;
  current = undefined;
  if (previous) await close(previous.ownerId, previous.opening);
}

/** Os campos que o formulário edita. */
export type ClientValues = Omit<ClientRecord, "id" | "version">;

/**
 * Cria (sem `id`) ou edita um client: aplica na hora e enfileira o `PUT`. A edição mantém a `version` do registro;
 * salvar de novo apaga o rascunho recusado. Devolve o id.
 */
export function saveClient(
  { clients, drafts, outbox }: ClientsStore,
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
