import type { InspectionKind } from "./inspection";

// O laudo de /inspections/report (Figma 177:16524), como a folha o recebe: o service monta, a folha só mostra.

/** Uma linha dos dados do laudo: "Imóvel", "Rua das Flores, 120 · ap 32 · …". */
export interface ReportField {
  label: string;
  value: string;
}

export interface ReportItem {
  id: string;
  name: string;
  /** "Bom". */
  condition: string;
  notes: string | null;
  /** Só na saída, no item copiado da entrada: o que a entrada tinha. */
  reference?: { condition: string; notes: string | null };
}

export interface ReportRoom {
  id: string;
  /** "1. Sala". */
  title: string;
  items: ReportItem[];
}

export interface InspectionReport {
  kind: InspectionKind;
  /** "Laudo de vistoria de entrada". */
  title: string;
  fields: ReportField[];
  rooms: ReportRoom[];
  generalNotes: string | null;
}

/**
 * O que a tela do laudo mostra: a folha (estados 1 e 2 do frame), ou o aviso sem laudo, com a conclusão na fila
 * (estado 4), a vistoria em andamento (estado 5) ou que o aparelho não tem (estado 6).
 */
/** O aviso no lugar do laudo: "warning" com a conclusão na fila, "neutral" nos outros casos. */
export interface ReportNotice {
  tone: "warning" | "neutral";
  title: string;
  description: string;
}

export type ReportView =
  | { state: "report"; report: InspectionReport }
  | { state: "pending" | "inProgress" | "notFound"; notice: ReportNotice };
