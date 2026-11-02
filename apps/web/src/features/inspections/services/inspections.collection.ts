import type { IndexedDBInstance } from "@tanstack/db";

import { createSummarizedCollections } from "@/shared/db/summarized-collection";

import type { InspectionRecord } from "../models/inspection";
import type { InspectionSummary } from "../models/inspection-summary";
import { summaryOf } from "./inspections.summary";

// A store guarda o que o servidor confirmou (gravado pela mutationFn, em inspections.sync.ts); o que está pendente volta
// da outbox como estado otimista quando o app abre. Com milhares de vistorias, abrir a store inteira custava segundos
// (spike 2): a vistoria completa carrega por id, e a lista lê o resumo, gravado na mesma transação e lido inteiro numa
// store em memória simples (ADR 0048).

export function createInspectionCollections(db: IndexedDBInstance) {
  const { records, summaries } = createSummarizedCollections<InspectionRecord, InspectionSummary>({
    db,
    name: "inspections",
    summaryName: "inspectionSummaries",
    summarize: summaryOf,
  });
  return { inspections: records, inspectionSummaries: summaries };
}

type Created = ReturnType<typeof createInspectionCollections>;
export type InspectionsCollection = Created["inspections"];
export type InspectionSummaryStore = Created["inspectionSummaries"];
