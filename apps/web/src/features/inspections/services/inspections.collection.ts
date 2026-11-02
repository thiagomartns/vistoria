import { type IndexedDBInstance, createCollection } from "@tanstack/db";

import { syncedCollectionOptions } from "@/shared/db/local-db";

import type { InspectionRecord } from "../models/inspection";

// Como a de properties: a store guarda o que o servidor confirmou (gravado pela mutationFn, em inspections.sync.ts); o
// que está pendente volta da outbox como estado otimista quando o app abre.

export function createInspectionsCollection(db: IndexedDBInstance) {
  return createCollection(syncedCollectionOptions<InspectionRecord>(db, "inspections"));
}

export type InspectionsCollection = ReturnType<typeof createInspectionsCollection>;
