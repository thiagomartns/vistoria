import {
  type DraftRecord,
  type DraftSyncState,
  draftSyncState,
  needsAction,
} from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import {
  INSPECTION_ENTITY,
  type InspectionKind,
  type InspectionRecord,
  type InspectionStatus,
} from "../models/inspection";
import { roomOfError } from "../schemas/inspection.schemas";

// Do banco local para o que a lista de vistorias e a tela de campo mostram. Funções puras: cada estado cabe num
// teste, e os componentes recebem só o resultado.

/** O estado do SyncBadge de uma vistoria. */
export type InspectionSyncState = RecordSyncState | "sincronizado" | DraftSyncState;

export const INSPECTION_KINDS: Record<InspectionKind, string> = {
  moveIn: "Entrada",
  moveOut: "Saída",
};

export const INSPECTION_STATUSES: Record<InspectionStatus, string> = {
  inProgress: "Em andamento",
  completed: "Concluída",
};

/** O imóvel de uma vistoria como a lista mostra: o endereço e o nome do cliente. */
export interface PlaceView {
  /** "Rua das Flores, 120 · ap 32". */
  address: string;
  clientName: string | null;
}

export interface InspectionRow {
  id: string;
  propertyId: string;
  /** O endereço do imóvel no aparelho, ou null se ele não está aqui. */
  address: string | null;
  clientName: string | null;
  /** "Entrada". */
  kindLabel: string | null;
  status: InspectionStatus | null;
  /** "Em andamento". */
  statusLabel: string | null;
  startedAt: string;
  /** Itens com condição e o total de itens. */
  evaluated: number;
  items: number;
  sync: InspectionSyncState;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

const isKind = (value: unknown): value is InspectionKind =>
  typeof value === "string" && Object.hasOwn(INSPECTION_KINDS, value);

const isStatus = (value: unknown): value is InspectionStatus =>
  typeof value === "string" && Object.hasOwn(INSPECTION_STATUSES, value);

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null) : [];

function fieldsOf(
  record: Record<string, unknown>,
  id: string,
  places: ReadonlyMap<string, PlaceView>,
): Omit<InspectionRow, "sync"> {
  const propertyId = text(record.propertyId) ?? "";
  const place = places.get(propertyId);
  const items = list(record.rooms).flatMap((room) => list(room.items));
  const status = isStatus(record.status) ? record.status : null;
  return {
    id,
    propertyId,
    address: place?.address ?? null,
    clientName: place?.clientName ?? null,
    kindLabel: isKind(record.kind) ? INSPECTION_KINDS[record.kind] : null,
    status,
    statusLabel: status ? INSPECTION_STATUSES[status] : null,
    startedAt: text(record.startedAt) ?? "",
    evaluated: items.filter((item) => item.condition != null).length,
    items: items.length,
  };
}

/**
 * Uma vistoria como a lista mostra. O rascunho recusado ou em conflito vence: ele tem o que a pessoa fez e o servidor
 * não aceitou (e, numa criação recusada, é o único lugar onde a vistoria ainda existe). O rascunho que só guarda o
 * passo da tela de campo (`draft`) não muda nada.
 */
export function inspectionRowOf(
  inspection: InspectionRecord | undefined,
  draft: DraftRecord | undefined,
  syncState: RecordSyncState | undefined,
  places: ReadonlyMap<string, PlaceView> = new Map(),
): InspectionRow | undefined {
  if (needsAction(draft))
    return { ...fieldsOf(draft.data, draft.id, places), sync: draftSyncState(draft) };
  if (!inspection) return undefined;
  return { ...fieldsOf(inspection, inspection.id, places), sync: syncState ?? "sincronizado" };
}

/**
 * As linhas da lista: vistorias e rascunhos (recusados ou em conflito) de vistoria. Em andamento primeiro, depois a
 * mais recente (nota do wireframe 67:1491).
 */
export function inspectionRows(
  inspections: readonly InspectionRecord[],
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
  places: ReadonlyMap<string, PlaceView>,
): InspectionRow[] {
  const drafts = allDrafts.filter((draft) => draft.entity === INSPECTION_ENTITY);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const rows = inspections.map((inspection) =>
    inspectionRowOf(inspection, draftById.get(inspection.id), states.get(inspection.id), places),
  );
  const known = new Set(inspections.map((inspection) => inspection.id));
  for (const draft of drafts) {
    if (!known.has(draft.id)) rows.push(inspectionRowOf(undefined, draft, undefined, places));
  }
  const rank = (row: InspectionRow) => (row.status === "completed" ? 1 : 0);
  return rows
    .filter((row) => row !== undefined)
    .toSorted((a, b) => rank(a) - rank(b) || b.startedAt.localeCompare(a.startedAt));
}

/** "19/10/2026". */
export function dateOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR");
}

const dayAndTime = (date: Date) => ({
  day: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
  time: date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
});

/** "Iniciada em 19/10, 09:12" (meta da linha no celular). */
export function startedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { day, time } = dayAndTime(date);
  return `Iniciada em ${day}, ${time}`;
}

// --- Tela de campo ---

/** O cabeçalho da tela de campo (Figma 43:1751): o endereço e "Vistoria de entrada · cliente · iniciada em …". */
export function fieldHeader(
  inspection: Pick<InspectionRecord, "kind" | "startedAt">,
  place: PlaceView | undefined,
): { title: string; subtitle: string; compactSubtitle: string } {
  const kind = `Vistoria de ${inspection.kind === "moveOut" ? "saída" : "entrada"}`;
  const date = new Date(inspection.startedAt);
  const started = Number.isNaN(date.getTime())
    ? null
    : `iniciada em ${dayAndTime(date).day} às ${dayAndTime(date).time}`;
  return {
    title: place?.address ?? "Vistoria",
    subtitle: [kind, place?.clientName, started].filter(Boolean).join(" · "),
    compactSubtitle: kind,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type RoomStepState = "pendente" | "completa" | "erro";

export interface RoomView {
  id: string;
  name: string;
  state: RoomStepState;
  /** "3 de 8", "2 erros", "0 itens" (a etapa). */
  meta: string;
  /** "3 de 8 itens avaliados", "Nenhum item ainda" (o cabeçalho do ambiente). */
  progress: string;
  /** Erros do servidor neste ambiente. */
  errors: number;
}

/** Os ambientes como etapas, com o progresso das condições marcadas e os erros que o servidor devolveu em cada um. */
export function roomViews(
  rooms: readonly { id: string; name: string; items: readonly { condition: unknown }[] }[],
  serverErrors: Readonly<Record<string, string[]>> = {},
): RoomView[] {
  const errorsByRoom = new Map<number, number>();
  for (const key of Object.keys(serverErrors)) {
    const room = roomOfError(key);
    if (room !== undefined) errorsByRoom.set(room, (errorsByRoom.get(room) ?? 0) + 1);
  }
  return rooms.map((room, index) => {
    const total = room.items.length;
    const evaluated = room.items.filter((item) => item.condition != null).length;
    const errors = errorsByRoom.get(index) ?? 0;
    const state: RoomStepState =
      errors > 0 ? "erro" : total > 0 && evaluated === total ? "completa" : "pendente";
    return {
      id: room.id,
      name: room.name,
      state,
      meta:
        errors > 0
          ? plural(errors, "erro", "erros")
          : total === 0
            ? "0 itens"
            : `${evaluated} de ${total}`,
      progress:
        total === 0
          ? "Nenhum item ainda"
          : `${evaluated} de ${plural(total, "item avaliado", "itens avaliados")}`,
      errors,
    };
  });
}

/** "2 de 7 concluídos". */
export function roomsSummary(rooms: readonly RoomView[]): string {
  const done = rooms.filter((room) => room.state === "completa").length;
  return `${done} de ${plural(rooms.length, "concluído", "concluídos")}`;
}

type ItemValues = { id: string; condition: unknown; notes: unknown };

const itemsOf = (record: Record<string, unknown> | undefined): ItemValues[] =>
  list(record?.rooms).flatMap((room) => list(room.items)) as ItemValues[];

/**
 * Os itens que mudaram no aparelho e o servidor ainda não confirmou: os que diferem da base (o `original` da transação
 * mais antiga do registro na fila). Numa criação não há base: conta o que a pessoa já marcou.
 */
export function pendingItemIds(
  current: Pick<InspectionRecord, "rooms">,
  base: Record<string, unknown> | undefined,
): Set<string> {
  const confirmed = new Map(itemsOf(base).map((item) => [item.id, item]));
  const pending = new Set<string>();
  for (const item of current.rooms.flatMap((room) => room.items)) {
    const before = confirmed.get(item.id);
    const condition = before?.condition ?? null;
    const notes = before?.notes ?? null;
    if (item.condition !== condition || (item.notes ?? null) !== notes) pending.add(item.id);
  }
  return pending;
}
