import { type IndexedDBInstance, createCollection, indexedDBCollectionOptions } from "@tanstack/db";

import type { ClientRecord } from "../models/client";

// A store guarda o que o servidor confirmou (gravado pela mutationFn, em clients.sync.ts); o que está
// pendente volta da outbox como estado otimista quando o app abre.

export function createClientsCollection(db: IndexedDBInstance) {
  return createCollection(
    indexedDBCollectionOptions<ClientRecord, string>({
      db,
      name: "clients",
      getKey: (client) => client.id,
    }),
  );
}

export type ClientsCollection = ReturnType<typeof createClientsCollection>;
