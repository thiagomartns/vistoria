import { clock } from "@/shared/clock";
import { byText, fold } from "@/shared/search";
import {
  type DraftRecord,
  type DraftSyncState,
  draftSyncState,
  needsAction,
} from "@/shared/sync/drafts";
import type { PendingRecord, RecordSyncState } from "@/shared/sync/sync-view";

import {
  INSPECTION_ENTITY,
  type InspectionKind,
  type InspectionRecord,
  type InspectionStatus,
  type ItemRecord,
  type RoomRecord,
} from "../models/inspection";
import {
  INSPECTION_PERIODS,
  type InspectionFilters,
  type InspectionPeriod,
  NO_FILTERS,
  isFiltered,
} from "../models/inspection-filters";
import type { InspectionSummary } from "../models/inspection-summary";
import { CONDITIONS, roomOfError } from "../schemas/inspection.schemas";
import { DEFAULT_TEMPLATE, type RoomMold } from "./inspections.factory";
import type { InspectionCollision } from "./inspections.merge";
import { type ChangeSummary, type InspectionConflict, collisionKey } from "./inspections.resolve";

// Do banco local para o que a lista de vistorias e a tela de campo mostram. Funções puras: cada estado cabe num
// teste, e os componentes recebem só o resultado.

/** O estado do SyncBadge de uma vistoria. "excluindo": a exclusão está na fila (ADR 0039). */
export type InspectionSyncState = RecordSyncState | "sincronizado" | DraftSyncState | "excluindo";

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
  /** O cliente do imóvel, para o filtro por cliente (#175). */
  clientId?: string;
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

const count = (value: unknown) => (typeof value === "number" ? value : 0);

/** Itens avaliados e o total: contados nos ambientes de um registro, ou já contados num resumo. */
function itemCounts(record: Record<string, unknown>): { evaluated: number; items: number } {
  if (!Array.isArray(record.rooms)) {
    return { evaluated: count(record.evaluated), items: count(record.items) };
  }
  const items = list(record.rooms).flatMap((room) => list(room.items));
  return { evaluated: items.filter((item) => item.condition != null).length, items: items.length };
}

function fieldsOf(
  record: Record<string, unknown>,
  id: string,
  places: ReadonlyMap<string, PlaceView>,
): Omit<InspectionRow, "sync"> {
  const propertyId = text(record.propertyId) ?? "";
  const place = places.get(propertyId);
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
    ...itemCounts(record),
  };
}

/** Uma vistoria na lista: o resumo confirmado, ou a vistoria como a fila a deixa (ADR 0048). */
type ListedInspection = (InspectionSummary | InspectionRecord) & { deleting?: true };

/** Os resumos confirmados com a fila por cima, por id: sem a excluída, e a com a exclusão na fila marcada (ADR 0048). */
function listedOf(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
): Map<string, ListedInspection> {
  const listed = new Map<string, ListedInspection>(summaries.map((summary) => [summary.id, summary]));
  for (const [id, entry] of pending) {
    if (entry.removed) listed.delete(id);
    else listed.set(id, entry.record as InspectionRecord);
  }
  return listed;
}

/**
 * Uma vistoria como a lista mostra. Com a exclusão na fila, ela fica "Excluindo" até o 204. Fora isso, o rascunho
 * recusado ou em conflito vence: ele tem o que a pessoa fez e o servidor não aceitou (e, numa criação recusada, é o
 * único lugar onde a vistoria ainda existe). O rascunho que só guarda o passo da tela de campo (`draft`) não muda nada.
 */
export function inspectionRowOf(
  inspection: ListedInspection | undefined,
  draft: DraftRecord | undefined,
  syncState: RecordSyncState | undefined,
  places: ReadonlyMap<string, PlaceView> = new Map(),
): InspectionRow | undefined {
  if (inspection?.deleting)
    return { ...fieldsOf(inspection, inspection.id, places), sync: "excluindo" };
  if (needsAction(draft))
    return { ...fieldsOf(draft.data, draft.id, places), sync: draftSyncState(draft) };
  if (!inspection) return undefined;
  return { ...fieldsOf(inspection, inspection.id, places), sync: syncState ?? "sincronizado" };
}

/**
 * As linhas da lista: os resumos confirmados, com a vistoria como a fila a deixa por cima (criada, alterada, saindo ou
 * excluída antes de o servidor a conhecer), e os rascunhos (recusados ou em conflito) de vistoria. A lista nunca abre
 * as vistorias completas (ADR 0048). Em andamento primeiro, depois a mais recente (nota do wireframe 67:1491).
 */
export function inspectionRows(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
  places: ReadonlyMap<string, PlaceView>,
): InspectionRow[] {
  return inspectionPage(summaries, pending, allDrafts, states, places, Infinity).rows;
}

/**
 * As primeiras `limit` linhas da lista, quantas casam com a busca e os filtros (`total`) e quantas o aparelho tem
 * (`all`). O filtro vem antes da ordem e da página, então "Mostrar mais" anda sobre o resultado filtrado (#175). A
 * ordem sai de uma chave leve (status e início, do resumo, da fila ou do rascunho que vence), e só as linhas da página
 * são montadas: com 10 mil vistorias, montar todas a cada render custava 200 ms no celular (ADR 0048).
 */
export function inspectionPage(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
  places: ReadonlyMap<string, PlaceView>,
  limit: number,
  filters: InspectionFilters = NO_FILTERS,
): { rows: InspectionRow[]; total: number; all: number } {
  const all = listEntries(summaries, pending, allDrafts);
  const entries = isFiltered(filters) ? all.filter(matcherOf(filters, places, clock.now())) : all;
  entries.sort((a, b) => Number(a.completed) - Number(b.completed) || newest(a, b));
  const rows = entries
    .slice(0, limit)
    .map((entry) => inspectionRowOf(entry.inspection, entry.draft, states.get(entry.id), places))
    .filter((row) => row !== undefined);
  return { rows, total: entries.length, all: all.length };
}

/** Uma vistoria da lista, com o que decide a ordem e o filtro, antes de virar linha. */
interface ListEntry {
  id: string;
  inspection: ListedInspection | undefined;
  draft: DraftRecord | undefined;
  propertyId: string;
  kind: InspectionKind | null;
  status: InspectionStatus | null;
  completed: boolean;
  startedAt: string;
}

/**
 * As vistorias da lista, sem montar as linhas: os resumos com a fila por cima e os rascunhos de vistoria (recusados ou
 * em conflito) que só existem neles. Os campos vêm da mesma fonte do `inspectionRowOf`: saindo, a vistoria; com
 * rascunho recusado ou em conflito, ele; senão, ela.
 */
function listEntries(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
  allDrafts: readonly DraftRecord[],
): ListEntry[] {
  const drafts = allDrafts.filter((draft) => draft.entity === INSPECTION_ENTITY);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const listed = listedOf(summaries, pending);
  const entryOf = (
    id: string,
    inspection: ListedInspection | undefined,
    draft: DraftRecord | undefined,
  ): ListEntry => {
    const source: Record<string, unknown> =
      !inspection?.deleting && needsAction(draft) ? draft.data : (inspection ?? {});
    return {
      id,
      inspection,
      draft,
      propertyId: text(source.propertyId) ?? "",
      kind: isKind(source.kind) ? source.kind : null,
      status: isStatus(source.status) ? source.status : null,
      completed: source.status === "completed",
      startedAt: text(source.startedAt) ?? "",
    };
  };
  const entries: ListEntry[] = [];
  for (const [id, inspection] of listed) entries.push(entryOf(id, inspection, draftById.get(id)));
  for (const draft of drafts) {
    if (!listed.has(draft.id) && needsAction(draft)) entries.push(entryOf(draft.id, undefined, draft));
  }
  return entries;
}

/** O começo do período: a meia-noite local do primeiro dia dele, contando hoje. */
export function periodStart(period: InspectionPeriod, now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "7d") start.setDate(start.getDate() - 6);
  else if (period === "30d") start.setDate(start.getDate() - 29);
  else start.setFullYear(start.getFullYear() - 1, start.getMonth(), start.getDate() + 1);
  return start;
}

/**
 * O teste de uma vistoria da lista contra a busca e os filtros (#175), montado uma vez por render. Tudo sai do que a
 * lista já lê: tipo, status e início do resumo, da fila ou do rascunho que vence; o cliente e o texto da busca, do
 * imóvel no aparelho. A busca casa com o endereço e o nome do cliente, sem acento e sem caixa, e é conferida uma vez
 * por imóvel, não por vistoria: com 10 mil vistorias, os imóveis são poucos. A vistoria de um imóvel fora do aparelho
 * não casa com busca nem com cliente.
 */
function matcherOf(
  filters: InspectionFilters,
  places: ReadonlyMap<string, PlaceView>,
  now: Date,
): (entry: ListEntry) => boolean {
  const query = fold(filters.query.trim());
  const since = filters.period ? periodStart(filters.period, now).getTime() : null;
  const found = new Map<string, boolean>();
  const searched = (propertyId: string) => {
    let hit = found.get(propertyId);
    if (hit === undefined) {
      const place = places.get(propertyId);
      hit =
        place !== undefined &&
        (fold(place.address).includes(query) || fold(place.clientName ?? "").includes(query));
      found.set(propertyId, hit);
    }
    return hit;
  };
  return (entry) =>
    (filters.kind === null || entry.kind === filters.kind) &&
    (filters.status === null || entry.status === filters.status) &&
    (filters.propertyId === null || entry.propertyId === filters.propertyId) &&
    (filters.clientId === null || places.get(entry.propertyId)?.clientId === filters.clientId) &&
    (since === null || Date.parse(entry.startedAt) >= since) &&
    (query === "" || searched(entry.propertyId));
}

/** Uma opção de Select dos filtros. */
export interface FilterOption {
  value: string;
  label: string;
}

/** Os imóveis do Select "Imóvel", pelo endereço; com um cliente escolhido, só os dele. */
export function propertyOptionsOf(
  places: ReadonlyMap<string, PlaceView>,
  clientId: string | null,
): FilterOption[] {
  return [...places]
    .filter(([, place]) => clientId === null || place.clientId === clientId)
    .map(([id, place]) => ({ value: id, label: place.address }))
    .toSorted((a, b) => byText(a.label, b.label));
}

/** As opções do Select "Período". */
export const PERIOD_OPTIONS: { value: InspectionPeriod; label: string }[] = (
  Object.entries(INSPECTION_PERIODS) as [InspectionPeriod, string][]
).map(([value, label]) => ({ value, label }));

// `startedAt` é ISO 8601 em UTC: a ordem das strings é a das datas, sem o custo do `localeCompare` em 10 mil linhas.
const newest = (a: { startedAt: string }, b: { startedAt: string }) =>
  a.startedAt === b.startedAt ? 0 : a.startedAt < b.startedAt ? 1 : -1;

/**
 * O histórico de um imóvel (#176): as vistorias dele, como a lista as lê (o resumo com a fila por cima e os rascunhos),
 * só pela data de início, da mais nova para a mais antiga. Numa linha do tempo, a em andamento se destaca pelo
 * marcador, não pela posição.
 */
export function propertyHistory(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
  propertyId: string,
): InspectionRow[] {
  return listEntries(summaries, pending, allDrafts)
    .filter((entry) => entry.propertyId === propertyId)
    .sort(newest)
    .map((entry) => inspectionRowOf(entry.inspection, entry.draft, states.get(entry.id)))
    .filter((row) => row !== undefined);
}

/** Um item da linha do tempo do imóvel (Figma TimelineItem 231:1825). */
export interface HistoryEntryView {
  /** "Saída · Em andamento". */
  title: string;
  /** "Iniciada em 19/10/2026 · 12 de 29 itens"; os itens só na em andamento. */
  meta: string;
  /** Em andamento vazado, concluída cheio, com a exclusão na fila apagado. */
  marker: "hollow" | "filled" | "muted";
}

export function historyEntryOf(row: InspectionRow): HistoryEntryView {
  const started = `Iniciada em ${dateOf(row.startedAt)}`;
  const ongoing = row.status !== "completed";
  return {
    title: [row.kindLabel, row.statusLabel].filter(Boolean).join(" · "),
    meta: ongoing && row.items > 0 ? `${started} · ${row.evaluated} de ${plural(row.items, "item", "itens")}` : started,
    marker: row.sync === "excluindo" ? "muted" : ongoing ? "hollow" : "filled",
  };
}

/**
 * Quantas linhas a lista monta de cada vez. Montar todas trava a tela com milhares de vistorias no aparelho (spike 2,
 * ADR 0047); com busca ou filtro, vale sobre o resultado filtrado (#175).
 */
export const LIST_PAGE_SIZE = 50;

/** "6 vistorias", "1 vistoria"; com a lista cortada, "50 de 10.000 vistorias". */
export function countLabel(shown: number, total: number): string {
  const noun = total === 1 ? "vistoria" : "vistorias";
  const all = total.toLocaleString("pt-BR");
  return shown < total ? `${shown.toLocaleString("pt-BR")} de ${all} ${noun}` : `${all} ${noun}`;
}

/** Só a vistoria em andamento pode ser excluída, e só uma vez: a que já está saindo não mostra o "···". */
export const isDeletable = (row: Pick<InspectionRow, "status" | "sync">): boolean =>
  row.status === "inProgress" && row.sync !== "excluindo";

/** Há alteração que o servidor ainda não tem (o Dialog avisa que ela é descartada). */
export const hasUnsent = (sync: InspectionSyncState | undefined): boolean =>
  sync !== undefined && sync !== "sincronizado" && sync !== "excluindo";

/** O que o Dialog de exclusão nomeia: "Rua das Flores, 120 · ap 32 · Vistoria de entrada". */
export function deletionSubject(address: string, kindLabel: string | null): string {
  return kindLabel ? `${address} · Vistoria de ${kindLabel.toLowerCase()}` : address;
}

// Um formatador por formato, reaproveitado: o `toLocaleDateString` cria um a cada chamada, e isso custava mais de um
// segundo numa lista de 10 mil vistorias (spike 2). A saída é a mesma.
const DATE = new Intl.DateTimeFormat("pt-BR");
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "19/10/2026". */
export function dateOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
}

/** "09:12". */
const timeOf = (iso: string) => TIME.format(new Date(iso));

const dayAndTime = (date: Date) => ({ day: DAY.format(date), time: TIME.format(date) });

/** "Iniciada em 19/10, 09:12" (meta da linha no celular). */
export function startedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const { day, time } = dayAndTime(date);
  return `Iniciada em ${day}, ${time}`;
}

// --- Tela de campo ---

/** Uma data ISO válida, ou `null`. */
function parsedDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * O cabeçalho da tela de campo (Figma 43:1751): o endereço e "Vistoria de entrada · cliente · iniciada em …". Concluída
 * (Figma 164:12824, estados 4 e 5), a data é a da conclusão; com a conclusão ainda na fila, "concluída neste aparelho".
 */
export function fieldHeader(
  inspection: Pick<InspectionRecord, "kind" | "startedAt" | "status" | "completedAt">,
  place: PlaceView | undefined,
): { title: string; subtitle: string; compactSubtitle: string } {
  const kind = `Vistoria de ${inspection.kind === "moveOut" ? "saída" : "entrada"}`;
  const completed = inspection.status === "completed";
  const date = parsedDate(completed ? inspection.completedAt : inspection.startedAt);
  const when = date
    ? `${completed ? "concluída" : "iniciada"} em ${dayAndTime(date).day} às ${dayAndTime(date).time}`
    : completed
      ? "concluída neste aparelho"
      : null;
  return {
    title: place?.address ?? "Vistoria",
    subtitle: [kind, place?.clientName, when].filter(Boolean).join(" · "),
    compactSubtitle: completed ? `${kind} · concluída` : kind,
  };
}

export const COMPLETED_DESCRIPTION = "O registro está travado e não pode mais ser editado.";
export const COMPLETION_PENDING_TITLE = "Conclusão aguardando envio";
export const COMPLETION_PENDING_DESCRIPTION =
  "A vistoria está travada neste aparelho e será concluída no servidor quando a conexão voltar.";

/** O aviso de uma vistoria concluída na tela de campo (Figma 164:12824, estados 4 e 5), ou `null` em andamento. */
export interface CompletionView {
  /** "success": o servidor confirmou; "pending": a conclusão está na fila. */
  tone: "success" | "pending";
  title: string;
  description: string;
}

/**
 * Concluída e confirmada: "Vistoria concluída por Thiago Martins em 19/10/2026 às 14:32" (ADR 0053). Sem a autoria ou
 * sem a data, de uma concluída baixada antes de o aparelho guardá-las, cada parte que falta sai da frase, até "Vistoria
 * concluída". Com a conclusão na fila (`pending`), o aviso de envio.
 */
export function completionView(
  inspection: Pick<InspectionRecord, "status" | "completedAt" | "completedBy">,
  pending: boolean,
): CompletionView | null {
  if (inspection.status !== "completed") return null;
  if (pending) {
    return {
      tone: "pending",
      title: COMPLETION_PENDING_TITLE,
      description: COMPLETION_PENDING_DESCRIPTION,
    };
  }
  const date = parsedDate(inspection.completedAt);
  const author = inspection.completedBy?.name;
  return {
    tone: "success",
    title: [
      "Vistoria concluída",
      author && `por ${author}`,
      date && `em ${DATE.format(date)} às ${TIME.format(date)}`,
    ]
      .filter(Boolean)
      .join(" "),
    description: COMPLETED_DESCRIPTION,
  };
}

/**
 * "Faltam itens para concluir" (Figma 164:12824, estado 3): o que a conclusão conferida no aparelho achou, por ambiente,
 * a partir das chaves de `completionErrors`.
 */
export const INCOMPLETE_TITLE = "Faltam itens para concluir";

export function incompleteDescription(
  errors: Readonly<Record<string, string[]>>,
  roomNames: readonly string[],
): string {
  const keys = Object.keys(errors);
  const missing = keys.filter((key) => key.endsWith(".condition"));
  const empty = keys.filter((key) => /^rooms\[\d+\]\.items$/.test(key));
  const parts: string[] = [];
  if (keys.includes("rooms")) parts.push("A vistoria não tem nenhum ambiente.");
  if (missing.length > 0) {
    const rooms = [...new Set(missing.map(roomOfError))];
    const where =
      rooms.length === 1 && rooms[0] !== undefined
        ? `${plural(missing.length, "item", "itens")} da ${roomNames[rooms[0]] ?? "vistoria"}`
        : `${plural(missing.length, "item", "itens")} em ${rooms.length} ambientes`;
    parts.push(
      `${where} ${missing.length === 1 ? "está" : "estão"} sem condição. Escolha a condição e conclua de novo.`,
    );
  }
  if (empty.length > 0) {
    const names = empty.map((key) => roomNames[roomOfError(key) ?? -1]).filter(Boolean);
    parts.push(
      `${empty.length === 1 ? "Um ambiente está" : `${empty.length} ambientes estão`} sem itens${names.length > 0 ? ` (${names.join(", ")})` : ""}.`,
    );
  }
  return parts.join(" ");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type RoomStepState = "pendente" | "completa" | "erro" | "conflito";

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

/**
 * Os ambientes como etapas, com o progresso das condições marcadas, os erros que o servidor devolveu em cada um e os
 * que estão em disputa num conflito (o erro vence: ele pede correção antes).
 */
export function roomViews(
  rooms: readonly { id: string; name: string; items: readonly { condition: unknown }[] }[],
  serverErrors: Readonly<Record<string, string[]>> = {},
  conflictRooms: ReadonlySet<string> = new Set(),
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
    const conflict = errors === 0 && conflictRooms.has(room.id);
    const state: RoomStepState =
      errors > 0
        ? "erro"
        : conflict
          ? "conflito"
          : total > 0 && evaluated === total
            ? "completa"
            : "pendente";
    return {
      id: room.id,
      name: room.name,
      state,
      meta:
        errors > 0
          ? plural(errors, "erro", "erros")
          : conflict
            ? "Conflito"
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

type ItemValues = { id: string; name: unknown; condition: unknown; notes: unknown };

const itemsOf = (record: Record<string, unknown> | undefined): ItemValues[] =>
  list(record?.rooms).flatMap((room) => list(room.items)) as ItemValues[];

/**
 * Os itens que mudaram no aparelho e o servidor ainda não confirmou: os que diferem da base (o `original` da transação
 * mais antiga do registro na fila) no nome, na condição ou na observação, e os que ela não tem (incluídos aqui). Mudar
 * de posição não conta. Numa criação não há base: conta o que a pessoa já marcou ou renomeou.
 */
export function pendingItemIds(
  current: Pick<InspectionRecord, "rooms">,
  base: Record<string, unknown> | undefined,
): Set<string> {
  const confirmed = new Map(itemsOf(base).map((item) => [item.id, item]));
  // Uma base sem ambientes é a de uma criação: o item novo só conta se a pessoa já mexeu nele.
  const created = list(base?.rooms).length === 0;
  const pending = new Set<string>();
  for (const item of current.rooms.flatMap((room) => room.items)) {
    const before = confirmed.get(item.id);
    if (!created && !before) {
      pending.add(item.id);
      continue;
    }
    const changed =
      item.condition !== (before?.condition ?? null) ||
      (item.notes ?? null) !== (before?.notes ?? null) ||
      (before !== undefined && item.name !== before.name);
    if (changed) pending.add(item.id);
  }
  return pending;
}

// --- Conflito ---

/** Um campo em disputa como o ConflictResolver mostra (Figma ConflictResolver/Campo 30:1431). */
export interface ConflictFieldView {
  key: string;
  /** "Piso · Condição". */
  label: string;
  /** "Antes: Bom", "Antes: sem observação"; sem base, nada. */
  before: string | null;
  mine: string;
  theirs: string;
}

/** Os campos em disputa de um ambiente ("Cozinha") ou da vistoria ("Geral"). */
export interface ConflictGroupView {
  id: string;
  title: string;
  fields: ConflictFieldView[];
}

const ROOT_FIELDS: Record<string, string> = {
  generalNotes: "Observações gerais",
  propertyId: "Imóvel",
  kind: "Tipo",
  status: "Status",
  startedAt: "Início",
};
const ROOM_FIELDS: Record<string, string> = {
  name: "Nome do ambiente",
  notes: "Observação do ambiente",
};
const ITEM_FIELDS: Record<string, string> = {
  condition: "Condição",
  notes: "Observação",
  name: "Nome",
};

const isEmpty = (value: unknown) => value === null || value === undefined || value === "";

/** O valor de um campo como texto: a condição pelo nome, o imóvel pelo endereço, o vazio por extenso. */
function valueText(field: string, value: unknown, places: ReadonlyMap<string, PlaceView>): string {
  if (isEmpty(value)) {
    if (field === "condition") return "Sem condição";
    if (field === "notes" || field === "generalNotes") return "Sem observação";
    return "Sem valor";
  }
  const key = String(value);
  if (field === "condition") return CONDITIONS[key as keyof typeof CONDITIONS] ?? key;
  if (field === "kind") return INSPECTION_KINDS[key as InspectionKind] ?? key;
  if (field === "status") return INSPECTION_STATUSES[key as InspectionStatus] ?? key;
  if (field === "startedAt") return dateOf(key) || key;
  if (field === "propertyId") return places.get(key)?.address ?? "Imóvel fora deste aparelho";
  return key;
}

/** "Antes: Bom"; o vazio fica em minúscula no meio da frase ("Antes: sem observação"). */
function beforeText(field: string, value: unknown, places: ReadonlyMap<string, PlaceView>) {
  const shown = valueText(field, value, places);
  return `Antes: ${isEmpty(value) ? shown.charAt(0).toLowerCase() + shown.slice(1) : shown}`;
}

/** Um lado de um ambiente ou item removido de um lado e alterado do outro. */
const presence = (side: unknown, base: unknown) =>
  side === undefined ? "Removido" : base === undefined ? "Incluído" : "Mantido, com alterações";

/**
 * Os campos em disputa, agrupados: "Geral" (a raiz da vistoria) primeiro, depois os ambientes na ordem do merge (os que
 * só o servidor tem, na dele). Ambiente ou item removido de um lado e alterado do outro é um campo só ("Ambiente",
 * "Piso · Item"), com "Removido" de um lado.
 */
export function conflictGroups(
  conflict: InspectionConflict,
  places: ReadonlyMap<string, PlaceView> = new Map(),
): ConflictGroupView[] {
  const sides = [conflict.local, conflict.merged, conflict.server, conflict.base].filter(
    (side) => side !== undefined,
  );
  const rooms = new Map<string, RoomRecord>();
  const items = new Map<string, ItemRecord>();
  for (const side of sides) {
    for (const room of side.rooms) {
      if (!rooms.has(room.id)) rooms.set(room.id, room);
      for (const item of room.items) if (!items.has(item.id)) items.set(item.id, item);
    }
  }
  const order = [
    ...new Set([...conflict.merged.rooms, ...conflict.server.rooms].map((room) => room.id)),
  ];
  const groups = new Map<string, ConflictGroupView>();
  const fieldOf = (collision: InspectionCollision): ConflictFieldView => {
    const key = collisionKey(collision);
    const itemName = collision.itemId ? (items.get(collision.itemId)?.name ?? "Item") : null;
    if (collision.kind === "removed") {
      return {
        key,
        label: itemName ? `${itemName} · Item` : "Ambiente",
        before: null,
        mine: presence(collision.local, collision.base),
        theirs: presence(collision.server, collision.base),
      };
    }
    const { field } = collision;
    const names = !collision.roomId ? ROOT_FIELDS : itemName ? ITEM_FIELDS : ROOM_FIELDS;
    const name = names[field] ?? field;
    return {
      key,
      label: itemName ? `${itemName} · ${name}` : name,
      before: collision.base === undefined ? null : beforeText(field, collision.base, places),
      mine: valueText(field, collision.local, places),
      theirs: valueText(field, collision.server, places),
    };
  };
  for (const collision of conflict.collisions) {
    const id = collision.roomId ?? "";
    const group = groups.get(id) ?? {
      id,
      title: collision.roomId ? (rooms.get(collision.roomId)?.name ?? "Ambiente") : "Geral",
      fields: [],
    };
    group.fields.push(fieldOf(collision));
    groups.set(id, group);
  }
  const rank = (group: ConflictGroupView) => (group.id === "" ? -1 : order.indexOf(group.id));
  return [...groups.values()].toSorted((a, z) => rank(a) - rank(z));
}

/** Os ambientes e os itens em disputa: a etapa e o item da tela de campo ficam "Em conflito". */
export function conflictPlaces(conflict: InspectionConflict | undefined): {
  rooms: Set<string>;
  items: Set<string>;
} {
  const rooms = new Set<string>();
  const items = new Set<string>();
  for (const collision of conflict?.collisions ?? []) {
    if (collision.roomId) rooms.add(collision.roomId);
    if (collision.itemId) items.add(collision.itemId);
  }
  return { rooms, items };
}

// --- Conflito: excluída em outro aparelho (Figma 32:1472, ADR 0040) ---

/** O que o ConflictResolver tipo excluído mostra. */
export interface DeletedConflictView {
  /** "Apto 302, R. das Flores · Vistoria de entrada. Ela foi excluída em outro aparelho, …". */
  description: string;
  /** "Excluída às 14:58 em outro aparelho". */
  deleted: string;
  /** "Neste aparelho: 12 itens alterados em 4 ambientes. Recriar gera uma vistoria nova, com outro código." */
  changes: string;
}

/** "Excluída às 14:58 em outro aparelho"; de outro dia, "Excluída em 20/10 às 14:58 em outro aparelho". */
function deletedLabel(deletedAt: string | undefined, now: Date): string {
  const date = deletedAt ? new Date(deletedAt) : undefined;
  if (!date || Number.isNaN(date.getTime())) return "Excluída em outro aparelho";
  const { day, time } = dayAndTime(date);
  const when = date.toDateString() === now.toDateString() ? `às ${time}` : `em ${day} às ${time}`;
  return `Excluída ${when} em outro aparelho`;
}

const RECREATE_NOTE = "Recriar gera uma vistoria nova, com outro código.";

export function deletedConflictView(
  header: { title: string; compactSubtitle: string },
  deletedAt: string | undefined,
  changes: ChangeSummary,
  now: Date = new Date(),
): DeletedConflictView {
  return {
    description: `${header.title} · ${header.compactSubtitle}. Ela foi excluída em outro aparelho, mas as suas alterações continuam salvas neste. Recrie a vistoria com os mesmos dados ou descarte as alterações.`,
    deleted: deletedLabel(deletedAt, now),
    changes:
      changes.items === 0
        ? RECREATE_NOTE
        : `Neste aparelho: ${plural(changes.items, "item alterado", "itens alterados")} em ${plural(changes.rooms, "ambiente", "ambientes")}. ${RECREATE_NOTE}`,
  };
}

/** Uma entrada de onde a saída pode partir, no Select da Nova vistoria. */
export interface MoveInOption {
  value: string;
  /** "Entrada de 26/10/2026 às 09:12 · 29 itens", e " · já tem saída" quando tem. */
  label: string;
  /** O aparelho tem uma saída feita a partir dela (#184). */
  hasMoveOut: boolean;
}

export const HAS_MOVE_OUT = "já tem saída";

/**
 * As entradas concluídas do imóvel, de onde a saída pode partir (wireframe 68:1878), da mais recente para a mais
 * antiga. Lê o resumo de cada vistoria com a fila por cima, como a lista (ADR 0048): a concluída offline, ainda na
 * fila, conta, porque a outbox é serial e a conclusão chega ao servidor antes da saída (ADR 0034). A excluída, ou com a
 * exclusão na fila, não entra. O rótulo fica no que o resumo tem: o início, com a hora (duas no mesmo dia se
 * distinguem), e o total de itens; a que está em `withMoveOut` diz que já tem saída (ADR 0059).
 */
export function moveInsOf(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
  propertyId: string,
  withMoveOut: ReadonlySet<string> = new Set(),
): MoveInOption[] {
  return livingOf(summaries, pending, propertyId, "moveIn")
    .filter((inspection) => inspection.status === "completed")
    .toSorted((a, b) => (a.startedAt === b.startedAt ? 0 : a.startedAt < b.startedAt ? 1 : -1))
    .map((inspection) => {
      const hasMoveOut = withMoveOut.has(inspection.id);
      const label = `Entrada de ${dateOf(inspection.startedAt)} às ${timeOf(inspection.startedAt)} · ${plural(
        itemCounts(inspection as Record<string, unknown>).items,
        "item",
        "itens",
      )}`;
      return {
        value: inspection.id,
        label: hasMoveOut ? `${label} · ${HAS_MOVE_OUT}` : label,
        hasMoveOut,
      };
    });
}

/** As vistorias de um tipo no imóvel, pelo resumo com a fila por cima, sem a excluída nem a com exclusão na fila. */
function livingOf(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
  propertyId: string,
  kind: InspectionKind,
): ListedInspection[] {
  return [...listedOf(summaries, pending).values()].filter(
    (inspection) =>
      !inspection.deleting && inspection.propertyId === propertyId && inspection.kind === kind,
  );
}

/**
 * As saídas do imóvel que o aparelho tem, confirmadas ou na fila (ADR 0059). O resumo não guarda a entrada de onde
 * cada uma partiu: a Nova vistoria lê só estas, inteiras, por id.
 */
export function moveOutIdsOf(
  summaries: readonly InspectionSummary[],
  pending: ReadonlyMap<string, PendingRecord>,
  propertyId: string,
): string[] {
  return livingOf(summaries, pending, propertyId, "moveOut").map((inspection) => inspection.id);
}

/** As entradas de onde as saídas lidas partiram. */
export function withMoveOutOf(moveOuts: readonly InspectionRecord[]): Set<string> {
  return new Set(
    moveOuts.flatMap((moveOut) => (moveOut.referenceInspectionId ? [moveOut.referenceInspectionId] : [])),
  );
}

/** A entrada escolhida por padrão: a mais recente sem saída, ou a mais recente, se todas têm (#184). */
export function defaultMoveInOf(options: readonly MoveInOption[]): MoveInOption | undefined {
  return options.find((option) => !option.hasMoveOut) ?? options[0];
}

/** O que a entrada tinha num item da saída, ao lado dele na tela de campo (Figma 42:1632 e 42:1715). */
export interface ItemReference {
  /** "Bom". */
  condition: string;
  notes: string | null;
}

/** A cópia da entrada num item da saída; o item sem cópia (a entrada, ou posto depois na saída) não tem. */
export function referenceOf(item: ItemRecord): ItemReference | undefined {
  return item.referenceCondition
    ? { condition: CONDITIONS[item.referenceCondition], notes: item.referenceNotes ?? null }
    : undefined;
}

/** Uma opção do Roteiro na nova vistoria: o id, "Apartamento · 5 ambientes, 29 itens" e os ambientes a copiar. */
export interface TemplateOption {
  value: string;
  label: string;
  rooms: readonly RoomMold[];
}

/** O valor da opção do roteiro padrão, que não é id de roteiro nenhum. */
export const DEFAULT_TEMPLATE_ID = "padrao";

const templateLabel = (name: string, rooms: readonly RoomMold[]) =>
  `${name} · ${plural(rooms.length, "ambiente", "ambientes")}, ${plural(
    rooms.reduce((total, room) => total + room.items.length, 0),
    "item",
    "itens",
  )}`;

/**
 * As opções do Roteiro na entrada (#174): os roteiros do aparelho, na ordem recebida (a da lista de roteiros, por
 * nome), com os ambientes na ordem da `position`. Roteiro sem ambiente fica de fora: a vistoria nasceria sem nada para
 * avaliar, e a tela de campo não cria ambiente. Sem nenhum que sirva, a opção única do roteiro padrão.
 */
export function templateOptionsOf(
  templates: readonly { id: string; name: string; rooms: readonly RoomMold[] }[],
): [TemplateOption, ...TemplateOption[]] {
  const [first, ...rest] = templates
    .filter((template) => template.rooms.length > 0)
    .map((template) => ({
      value: template.id,
      label: templateLabel(template.name, template.rooms),
      rooms: template.rooms,
    }));
  return first
    ? [first, ...rest]
    : [
        {
          value: DEFAULT_TEMPLATE_ID,
          label: templateLabel("Roteiro padrão", DEFAULT_TEMPLATE),
          rooms: DEFAULT_TEMPLATE,
        },
      ];
}
