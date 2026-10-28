import { byText, fold } from "@/shared/search";
import { type DraftRecord, type DraftSyncState, draftSyncState } from "@/shared/sync/drafts";
import { type FlatConflict, type FlatConflictGroup, flatConflictGroups } from "@/shared/sync/flat-conflict";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { PROPERTY_ENTITY, type PropertyRecord, type PropertyType } from "../models/property";
import { PROPERTY_TYPES, formatZipCode } from "../schemas/property.schemas";

// Do banco local para o que a lista de imóveis e o cabeçalho do registro mostram. Função pura: cada estado cabe num
// teste, e os componentes recebem só o resultado.

/** O estado do SyncBadge de um imóvel. */
export type PropertySyncState = RecordSyncState | "sincronizado" | DraftSyncState;

export interface PropertyRow {
  id: string;
  /** "Rua das Flores, 120 · ap 32". */
  address: string;
  clientId: string;
  /** O nome do cliente no aparelho, ou null se ele não está aqui. */
  clientName: string | null;
  type: PropertyType | null;
  /** "Apartamento". */
  typeLabel: string | null;
  district: string;
  city: string;
  state: string;
  zipCode: string;
  complement: string | null;
  number: string;
  street: string;
  notes: string | null;
  /** "São Paulo/SP". */
  place: string;
  sync: PropertySyncState;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

/** O endereço de uma linha: rua, número e, se houver, o complemento. */
export function addressOf(record: Record<string, unknown>): string {
  const street = `${text(record.street) ?? ""}, ${text(record.number) ?? ""}`;
  const complement = text(record.complement);
  return complement ? `${street} · ${complement}` : street;
}

const isType = (value: unknown): value is PropertyType =>
  typeof value === "string" && Object.hasOwn(PROPERTY_TYPES, value);

function fieldsOf(
  record: Record<string, unknown>,
  id: string,
  clientNames: ReadonlyMap<string, string>,
): Omit<PropertyRow, "sync"> {
  const clientId = text(record.clientId) ?? "";
  const type = isType(record.type) ? record.type : null;
  const city = text(record.city) ?? "";
  const state = text(record.state) ?? "";
  return {
    id,
    address: addressOf(record),
    clientId,
    clientName: clientNames.get(clientId) ?? null,
    type,
    typeLabel: type ? PROPERTY_TYPES[type] : null,
    district: text(record.district) ?? "",
    city,
    state,
    zipCode: text(record.zipCode) ?? "",
    complement: text(record.complement),
    number: text(record.number) ?? "",
    street: text(record.street) ?? "",
    notes: text(record.notes),
    place: [city, state].filter(Boolean).join("/"),
  };
}

/**
 * Um imóvel como a tela mostra. O rascunho (recusado ou em conflito) vence: ele tem o que a pessoa digitou e o
 * servidor não aceitou (e, numa criação recusada, é o único lugar onde o registro ainda existe).
 */
export function propertyRowOf(
  property: PropertyRecord | undefined,
  draft: DraftRecord | undefined,
  syncState: RecordSyncState | undefined,
  clientNames: ReadonlyMap<string, string> = new Map(),
): PropertyRow | undefined {
  if (draft) return { ...fieldsOf(draft.data, draft.id, clientNames), sync: draftSyncState(draft) };
  if (!property) return undefined;
  return { ...fieldsOf(property, property.id, clientNames), sync: syncState ?? "sincronizado" };
}

/** As linhas da lista: imóveis e rascunhos (recusados ou em conflito) de imóvel, em ordem de endereço. */
export function propertyRows(
  properties: readonly PropertyRecord[],
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
  clientNames: ReadonlyMap<string, string>,
): PropertyRow[] {
  const drafts = allDrafts.filter((draft) => draft.entity === PROPERTY_ENTITY);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const rows = properties.map((property) =>
    propertyRowOf(property, draftById.get(property.id), states.get(property.id), clientNames),
  );
  const known = new Set(properties.map((property) => property.id));
  for (const draft of drafts) {
    if (!known.has(draft.id)) rows.push(propertyRowOf(undefined, draft, undefined, clientNames));
  }
  return rows
    .filter((row) => row !== undefined)
    .toSorted((a, b) => byText(a.address, b.address));
}

/** Busca local por endereço, bairro e cidade. */
export function matchesSearch(row: PropertyRow, search: string): boolean {
  const query = fold(search.trim());
  if (query === "") return true;
  return [row.address, row.district, row.city].some((field) => fold(field).includes(query));
}

/** Os filtros da lista; `null` é "todos". */
export interface PropertyFilters {
  clientId: string | null;
  type: PropertyType | null;
}

export function matchesFilters(row: PropertyRow, filters: PropertyFilters): boolean {
  return (
    (filters.clientId === null || row.clientId === filters.clientId) &&
    (filters.type === null || row.type === filters.type)
  );
}

/** Quantos imóveis cada cliente tem no aparelho (coluna "Imóveis" de /clients). */
export function propertyCountByClient(properties: readonly PropertyRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const property of properties) {
    counts.set(property.clientId, (counts.get(property.clientId) ?? 0) + 1);
  }
  return counts;
}

/** Uma opção de cliente nos Select do imóvel. */
export interface ClientOption {
  value: string;
  label: string;
}

/** Os clientes do aparelho para escolher no imóvel, em ordem alfabética. */
export function clientOptionsOf(clients: readonly { id: string; name: string }[]): ClientOption[] {
  return clients
    .map((client) => ({ value: client.id, label: client.name }))
    .toSorted((a, b) => byText(a.label, b.label));
}

/**
 * Os campos em disputa de um imóvel, num grupo só ("Imóvel"), com os nomes e a ordem do formulário: o cliente pelo
 * nome, o tipo por extenso e o CEP com a máscara.
 */
export function propertyConflictGroups(
  conflict: FlatConflict<PropertyRecord>,
  clientNames: ReadonlyMap<string, string>,
): FlatConflictGroup[] {
  return flatConflictGroups(conflict, {
    title: "Imóvel",
    labels: {
      clientId: "Cliente",
      type: "Tipo",
      zipCode: "CEP",
      street: "Rua",
      number: "Número",
      complement: "Complemento",
      district: "Bairro",
      city: "Cidade",
      state: "UF",
      notes: "Observações",
    },
    format: (field, value) => {
      const shown = String(value);
      if (field === "clientId") return clientNames.get(shown) ?? "Cliente fora deste aparelho";
      if (field === "type") return isType(value) ? PROPERTY_TYPES[value] : shown;
      if (field === "zipCode") return formatZipCode(shown);
      return shown;
    },
    empty: { complement: "Sem complemento", notes: "Sem observação" },
  });
}
