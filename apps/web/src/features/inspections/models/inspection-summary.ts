import type { InspectionKind, InspectionStatus } from "./inspection";

/**
 * O resumo de uma vistoria: o que a linha da lista mostra, sem os ambientes e os itens (ADR 0048). Fica na store
 * `inspectionSummaries`, gravado na mesma transação da vistoria, com a mesma `version`.
 */
export type InspectionSummary = {
  id: string;
  version: string | null;
  propertyId: string;
  kind: InspectionKind;
  status: InspectionStatus;
  startedAt: string;
  /** Itens com condição. */
  evaluated: number;
  /** Todos os itens, de todos os ambientes. */
  items: number;
};
