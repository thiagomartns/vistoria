import { type IndexedDBInstance, createCollection } from "@tanstack/db";

import { syncedCollectionOptions } from "@/shared/db/local-db";

import type { PropertyRecord } from "../models/property";

// Como a de clients: a store guarda o que o servidor confirmou (gravado pela mutationFn, em properties.sync.ts); o que
// está pendente volta da outbox como estado otimista quando o app abre.

export function createPropertiesCollection(db: IndexedDBInstance) {
  return createCollection(syncedCollectionOptions<PropertyRecord>(db, "properties"));
}

export type PropertiesCollection = ReturnType<typeof createPropertiesCollection>;
