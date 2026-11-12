import { type IndexedDBInstance, createCollection } from "@tanstack/db";

import { syncedCollectionOptions } from "@/shared/db/local-db";

import type { TemplateRecord } from "../models/template";

// Como a de imóveis: a store guarda o que o servidor confirmou (gravado pela mutationFn, em templates.sync.ts); o que
// está pendente volta da outbox como estado otimista quando o app abre.

export function createTemplatesCollection(db: IndexedDBInstance) {
  return createCollection(syncedCollectionOptions<TemplateRecord>(db, "templates"));
}

export type TemplatesCollection = ReturnType<typeof createTemplatesCollection>;
