import type { PendingMutation } from "@tanstack/db";

import { upsertClient } from "@/shared/api/generated";
import type { Client } from "@/shared/api/generated/client";
import { closeLocalDb, openLocalDb } from "@/shared/db/local-db";
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

import type { ClientRecord } from "../models/client";
import { type ClientsCollection, createClientsCollection } from "./clients.collection";

export const UPSERT_CLIENT = "upsertClient";

registerRecordLabel(UPSERT_CLIENT, (record) => `Cliente · ${String(record.name ?? "")}`);

/**
 * Envia a transação como `PUT /api/v1/clients/{id}` com o registro completo e a chave da transação.
 * Só depois do 2xx o registro vai para a store local; antes disso ele vive na outbox.
 */
export function upsertClientMutation(
  clients: ClientsCollection,
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
    const { id, ...body } = mutation.modified;
    const result = await upsertClient({
      client,
      path: { id },
      body,
      headers: outboxHeaders(idempotencyKey),
    });
    if (!result.data) throw syncFailure(result);
    // Na 0.14, acceptMutations tipa as mutações como Record<string, unknown>, não pelo item da collection.
    await clients.utils.acceptMutations(transaction as unknown as { mutations: PendingMutation[] });
    recordSyncSuccess();
  };
}

export interface ClientsStore {
  clients: ClientsCollection;
  outbox: Outbox;
}

let current: { ownerId: string; opening: Promise<ClientsStore> } | undefined;

async function open(ownerId: string): Promise<ClientsStore> {
  const clients = createClientsCollection(await openLocalDb(ownerId));
  const outbox = startOutbox({
    ownerId,
    collections: { clients },
    mutationFns: { [UPSERT_CLIENT]: upsertClientMutation(clients) },
  });
  await outbox.waitForInit();
  trackOutbox(outbox);
  return { clients, outbox };
}

async function close(ownerId: string, opening: Promise<ClientsStore>): Promise<void> {
  const store = await opening.catch(() => undefined);
  store?.outbox.dispose();
  await store?.clients.cleanup();
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

/** Cria (sem `id`) ou edita um client: aplica na hora e enfileira o `PUT`. Devolve o id. */
export function saveClient(
  { clients, outbox }: ClientsStore,
  values: Omit<ClientRecord, "id"> & { id?: string },
): string {
  const record: ClientRecord = { ...values, id: values.id ?? newId() };
  enqueue(outbox, UPSERT_CLIENT, () => {
    if (clients.has(record.id)) {
      clients.update(record.id, (draft) => {
        Object.assign(draft, record);
      });
    } else {
      clients.insert(record);
    }
  });
  return record.id;
}
