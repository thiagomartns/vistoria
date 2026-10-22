import { type IndexedDBInstance, createCollection, indexedDBCollectionOptions } from "@tanstack/db";

import type { PropertyRecord } from "../models/property";

// Como a de clients: a store guarda o que o servidor confirmou (gravado pela mutationFn, em properties.sync.ts); o que
// está pendente volta da outbox como estado otimista quando o app abre.

export function createPropertiesCollection(db: IndexedDBInstance) {
  return createCollection(
    indexedDBCollectionOptions<PropertyRecord, string>({
      db,
      name: "properties",
      getKey: (property) => property.id,
    }),
  );
}

export type PropertiesCollection = ReturnType<typeof createPropertiesCollection>;
