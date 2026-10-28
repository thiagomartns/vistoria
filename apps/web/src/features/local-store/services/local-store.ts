import { closeLocalDb, openLocalDb } from "@/shared/db/local-db";
import { type DraftsCollection, createDraftsCollection } from "@/shared/sync/drafts";
import { type Outbox, startOutbox } from "@/shared/sync/outbox";
import { trackOutbox } from "@/shared/sync/sync-status";

import {
  type ClientsCollection,
  createClientsCollection,
} from "@/features/clients/services/clients.collection";
import { UPSERT_CLIENT, upsertClientMutation } from "@/features/clients/services/clients.sync";
import {
  type InspectionsCollection,
  createInspectionsCollection,
} from "@/features/inspections/services/inspections.collection";
import {
  DELETE_INSPECTION,
  UPSERT_INSPECTION,
  deleteInspectionMutation,
  upsertInspectionMutation,
} from "@/features/inspections/services/inspections.sync";
import {
  type PropertiesCollection,
  createPropertiesCollection,
} from "@/features/properties/services/properties.collection";
import {
  UPSERT_PROPERTY,
  upsertPropertyMutation,
} from "@/features/properties/services/properties.sync";

// O banco local do usuário: as collections de cada feature e uma outbox só para todas. É o único módulo que junta
// as features, porque a fila é uma: um imóvel criado com um cliente pendente sai depois dele, e uma vistoria, depois do
// imóvel (ADR 0034).

export interface LocalStore {
  clients: ClientsCollection;
  properties: PropertiesCollection;
  inspections: InspectionsCollection;
  drafts: DraftsCollection;
  outbox: Outbox;
}

let current: { ownerId: string; opening: Promise<LocalStore> } | undefined;

async function open(ownerId: string): Promise<LocalStore> {
  const db = await openLocalDb(ownerId);
  const clients = createClientsCollection(db);
  const properties = createPropertiesCollection(db);
  const inspections = createInspectionsCollection(db);
  const drafts = createDraftsCollection(db);
  const outbox = startOutbox({
    ownerId,
    collections: { clients, properties, inspections },
    mutationFns: {
      [UPSERT_CLIENT]: upsertClientMutation(clients, drafts),
      [UPSERT_PROPERTY]: upsertPropertyMutation(properties, drafts),
      [UPSERT_INSPECTION]: upsertInspectionMutation(inspections, drafts),
      [DELETE_INSPECTION]: deleteInspectionMutation(inspections, drafts),
    },
    removals: new Set([DELETE_INSPECTION]),
  });
  await outbox.waitForInit();
  trackOutbox(outbox);
  return { clients, properties, inspections, drafts, outbox };
}

async function close(ownerId: string, opening: Promise<LocalStore>): Promise<void> {
  const store = await opening.catch(() => undefined);
  store?.outbox.dispose();
  await store?.clients.cleanup();
  await store?.properties.cleanup();
  await store?.inspections.cleanup();
  await store?.drafts.cleanup();
  await closeLocalDb(ownerId);
}

/**
 * Abre o banco local, as collections e a outbox do usuário uma vez por página (só no navegador). Trocar de usuário
 * fecha os do anterior: a fila dele fica guardada no banco dele, sem enviar, até ele entrar de novo.
 */
export function openLocalStore(ownerId: string): Promise<LocalStore> {
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
export async function closeLocalStore(): Promise<void> {
  const previous = current;
  current = undefined;
  if (previous) await close(previous.ownerId, previous.opening);
}
