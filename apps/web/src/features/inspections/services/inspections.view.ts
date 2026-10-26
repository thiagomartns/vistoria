import { type DraftRecord, type DraftSyncState, draftSyncState } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { INSPECTION_ENTITY, type InspectionKind, type InspectionRecord } from "../models/inspection";

// Do banco local para o que a lista de vistorias mostra. Função pura: cada estado cabe num teste, e os componentes
// recebem só o resultado.

/** O estado do SyncBadge de uma vistoria. */
export type InspectionSyncState = RecordSyncState | "sincronizado" | DraftSyncState;

export const INSPECTION_KINDS: Record<InspectionKind, string> = { moveIn: "Entrada", moveOut: "Saída" };

export interface InspectionRow {
  id: string;
  propertyId: string;
  /** O endereço do imóvel no aparelho, ou null se ele não está aqui. */
  address: string | null;
  /** "Entrada". */
  kindLabel: string | null;
  startedAt: string;
  /** Itens com condição e o total de itens. */
  evaluated: number;
  items: number;
  sync: InspectionSyncState;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

const isKind = (value: unknown): value is InspectionKind =>
  typeof value === "string" && Object.hasOwn(INSPECTION_KINDS, value);

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null) : [];

function fieldsOf(
  record: Record<string, unknown>,
  id: string,
  addresses: ReadonlyMap<string, string>,
): Omit<InspectionRow, "sync"> {
  const propertyId = text(record.propertyId) ?? "";
  const items = list(record.rooms).flatMap((room) => list(room.items));
  return {
    id,
    propertyId,
    address: addresses.get(propertyId) ?? null,
    kindLabel: isKind(record.kind) ? INSPECTION_KINDS[record.kind] : null,
    startedAt: text(record.startedAt) ?? "",
    evaluated: items.filter((item) => item.condition != null).length,
    items: items.length,
  };
}

/**
 * Uma vistoria como a lista mostra. O rascunho (recusado ou em conflito) vence: ele tem o que a pessoa fez e o servidor
 * não aceitou (e, numa criação recusada, é o único lugar onde a vistoria ainda existe).
 */
export function inspectionRowOf(
  inspection: InspectionRecord | undefined,
  draft: DraftRecord | undefined,
  syncState: RecordSyncState | undefined,
  addresses: ReadonlyMap<string, string> = new Map(),
): InspectionRow | undefined {
  if (draft) return { ...fieldsOf(draft.data, draft.id, addresses), sync: draftSyncState(draft) };
  if (!inspection) return undefined;
  return { ...fieldsOf(inspection, inspection.id, addresses), sync: syncState ?? "sincronizado" };
}

/** As linhas da lista: vistorias e rascunhos (recusados ou em conflito) de vistoria, da mais recente para a mais antiga. */
export function inspectionRows(
  inspections: readonly InspectionRecord[],
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
  addresses: ReadonlyMap<string, string>,
): InspectionRow[] {
  const drafts = allDrafts.filter((draft) => draft.entity === INSPECTION_ENTITY);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const rows = inspections.map((inspection) =>
    inspectionRowOf(inspection, draftById.get(inspection.id), states.get(inspection.id), addresses),
  );
  const known = new Set(inspections.map((inspection) => inspection.id));
  for (const draft of drafts) {
    if (!known.has(draft.id)) rows.push(inspectionRowOf(undefined, draft, undefined, addresses));
  }
  return rows
    .filter((row) => row !== undefined)
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
}
