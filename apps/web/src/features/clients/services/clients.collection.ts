import { type IndexedDBInstance, createCollection } from "@tanstack/db";

import { syncedCollectionOptions } from "@/shared/db/local-db";

import type { ClientRecord } from "../models/client";

// A store guarda o que o servidor confirmou (gravado pela mutationFn, em clients.sync.ts); o que está
// pendente volta da outbox como estado otimista quando o app abre.

export function createClientsCollection(db: IndexedDBInstance) {
  return createCollection(syncedCollectionOptions<ClientRecord>(db, "clients"));
}

export type ClientsCollection = ReturnType<typeof createClientsCollection>;
