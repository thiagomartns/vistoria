import { byText, fold } from "@/shared/search";
import { type DraftRecord, type DraftSyncState, draftSyncState } from "@/shared/sync/drafts";
import {
  type FlatConflict,
  type FlatConflictGroup,
  flatConflictGroups,
} from "@/shared/sync/flat-conflict";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import {
  TEMPLATE_ENTITY,
  type TemplateItem,
  type TemplateRecord,
  type TemplateRoom,
} from "../models/template";

// Do banco local para o que a lista de roteiros e o editor mostram. Função pura: cada estado cabe num teste, e os
// componentes recebem só o resultado.

/** O estado do SyncBadge de um roteiro. */
export type TemplateSyncState = RecordSyncState | "sincronizado" | DraftSyncState;

export interface TemplateRow {
  id: string;
  name: string;
  /** Ambientes e itens na ordem da `position`. */
  rooms: TemplateRoom[];
  roomCount: number;
  itemCount: number;
  sync: TemplateSyncState;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null) : [];
const byPosition = <T extends { position: number }>(rows: T[]) =>
  rows.toSorted((a, b) => a.position - b.position);

const itemsOf = (value: unknown): TemplateItem[] =>
  byPosition(
    list(value).map((item, index) => ({
      id: text(item.id),
      name: text(item.name),
      position: typeof item.position === "number" ? item.position : index,
    })),
  );

/** Os ambientes de um registro (ou do rascunho, que é o corpo enviado), na ordem da `position`. */
export function roomsOf(value: unknown): TemplateRoom[] {
  return byPosition(
    list(value).map((room, index) => ({
      id: text(room.id),
      name: text(room.name),
      position: typeof room.position === "number" ? room.position : index,
      items: itemsOf(room.items),
    })),
  );
}

function fieldsOf(record: Record<string, unknown>, id: string): Omit<TemplateRow, "sync"> {
  const rooms = roomsOf(record.rooms);
  return {
    id,
    name: text(record.name),
    rooms,
    roomCount: rooms.length,
    itemCount: rooms.reduce((total, room) => total + room.items.length, 0),
  };
}

/**
 * Um roteiro como a tela mostra. O rascunho (recusado ou em conflito) vence: ele tem o que a pessoa salvou e o
 * servidor não aceitou (e, numa criação recusada, é o único lugar onde o roteiro ainda existe).
 */
export function templateRowOf(
  template: TemplateRecord | undefined,
  draft: DraftRecord | undefined,
  syncState: RecordSyncState | undefined,
): TemplateRow | undefined {
  if (draft) return { ...fieldsOf(draft.data, draft.id), sync: draftSyncState(draft) };
  if (!template) return undefined;
  return { ...fieldsOf(template, template.id), sync: syncState ?? "sincronizado" };
}

/** As linhas da lista: roteiros e rascunhos (recusados ou em conflito) de roteiro, em ordem de nome. */
export function templateRows(
  templates: readonly TemplateRecord[],
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
): TemplateRow[] {
  const drafts = allDrafts.filter((draft) => draft.entity === TEMPLATE_ENTITY);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const rows = templates.map((template) =>
    templateRowOf(template, draftById.get(template.id), states.get(template.id)),
  );
  const known = new Set(templates.map((template) => template.id));
  for (const draft of drafts) {
    if (!known.has(draft.id)) rows.push(templateRowOf(undefined, draft, undefined));
  }
  return rows.filter((row) => row !== undefined).toSorted((a, b) => byText(a.name, b.name));
}

/** Busca local pelo nome. */
export function matchesSearch(row: TemplateRow, search: string): boolean {
  const query = fold(search.trim());
  return query === "" || fold(row.name).includes(query);
}

/** "1 ambiente", "6 ambientes". */
export const roomsLabel = (count: number) => `${count} ${count === 1 ? "ambiente" : "ambientes"}`;
/** "1 item", "7 itens". */
export const itemsLabel = (count: number) => `${count} ${count === 1 ? "item" : "itens"}`;

/** Os ambientes de um lado do conflito, numa linha: "Sala (7 itens), Cozinha (8 itens)". */
export function roomsSummary(rooms: readonly TemplateRoom[]): string {
  return rooms.map((room) => `${room.name} (${itemsLabel(room.items.length)})`).join(", ");
}

/**
 * Os campos em disputa de um roteiro, num grupo "Roteiro" (ADR 0057): Nome e Ambientes, com a lista inteira de cada
 * lado resumida. O "Antes" dos ambientes conta ambientes e itens.
 */
export function templateConflictGroups(
  conflict: FlatConflict<TemplateRecord>,
): FlatConflictGroup[] {
  const groups = flatConflictGroups(conflict, {
    title: "Roteiro",
    labels: { name: "Nome", rooms: "Ambientes" },
    format: (field, value) => {
      if (field !== "rooms") return String(value);
      const rooms = roomsOf(value);
      return rooms.length === 0 ? "Sem ambientes" : roomsSummary(rooms);
    },
  });
  const baseRooms = conflict.base ? roomsOf(conflict.base.rooms) : null;
  return groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) =>
      field.key === "rooms" && baseRooms
        ? {
            ...field,
            before: `Antes: ${roomsLabel(baseRooms.length)}, ${itemsLabel(
              baseRooms.reduce((total, room) => total + room.items.length, 0),
            )}`,
          }
        : field,
    ),
  }));
}
