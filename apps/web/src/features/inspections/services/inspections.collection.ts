import { type IndexedDBInstance, createCollection, indexedDBCollectionOptions } from "@tanstack/db";

import type { InspectionRecord } from "../models/inspection";

// Como a de properties: a store guarda o que o servidor confirmou (gravado pela mutationFn, em inspections.sync.ts); o
// que está pendente volta da outbox como estado otimista quando o app abre.

export function createInspectionsCollection(db: IndexedDBInstance) {
  return createCollection(
    indexedDBCollectionOptions<InspectionRecord, string>({
      db,
      name: "inspections",
      getKey: (inspection) => inspection.id,
    }),
  );
}

export type InspectionsCollection = ReturnType<typeof createInspectionsCollection>;
