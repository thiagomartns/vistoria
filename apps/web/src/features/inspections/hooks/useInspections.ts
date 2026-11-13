import { useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";

import type { ClientRecord } from "@/features/clients/models/client";
import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import type { PropertyRecord } from "@/features/properties/models/property";
import { addressOf, clientOptionsOf } from "@/features/properties/services/properties.view";

import type { InspectionKind, InspectionStatus } from "../models/inspection";
import {
  type InspectionFilters,
  NO_FILTERS,
  activeFilterCount,
  filtersFromParams,
  filtersToSearch,
  isFiltered,
} from "../models/inspection-filters";

import { conflictHref } from "../services/inspections.resolve";
import { DELETE_INSPECTION, UPSERT_INSPECTION, deleteInspection } from "../services/inspections.sync";
import { useInspectionSummaries } from "./useInspectionSummaries";
import {
  INSPECTION_KINDS,
  INSPECTION_STATUSES,
  LIST_PAGE_SIZE,
  PERIOD_OPTIONS,
  type PlaceView,
  countLabel,
  dateOf,
  deletionSubject,
  hasUnsent,
  inspectionPage,
  isDeletable,
  propertyOptionsOf,
  startedLabel,
} from "../services/inspections.view";

/** A lista; para onde "Voltar" e "Cancelar" levam. */
export const INSPECTIONS_HREF = "/inspections";

/** A tela de campo de uma vistoria. */
export const inspectionHref = (id: string) => `/inspections/edit?id=${encodeURIComponent(id)}`;

/** O laudo de uma vistoria concluída. */
export const reportHref = (id: string) => `/inspections/report?id=${encodeURIComponent(id)}`;

/** O parâmetro da tela de campo e do laudo com o caminho do "Voltar" (#176). */
export const BACK_PARAM = "voltar";

/** `href` com o caminho do "Voltar" no `?voltar=`. */
export const withBack = (href: string, back: string) =>
  `${href}${href.includes("?") ? "&" : "?"}${BACK_PARAM}=${encodeURIComponent(back)}`;

/**
 * Para onde o "Voltar" leva: o `?voltar=` se for um caminho deste app ("/…", nunca "//…" nem "/\…", que o navegador
 * leria como outro host), senão a lista de vistorias.
 */
export function backHrefOf(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : INSPECTIONS_HREF;
}

const KIND_OPTIONS = (Object.entries(INSPECTION_KINDS) as [InspectionKind, string][]).map(
  ([value, label]) => ({ value, label }),
);
const STATUS_OPTIONS = (Object.entries(INSPECTION_STATUSES) as [InspectionStatus, string][]).map(
  ([value, label]) => ({ value, label }),
);

/** O imóvel de cada vistoria no aparelho: o endereço, o cliente e o nome dele. */
export function placesOf(
  properties: readonly PropertyRecord[],
  clients: readonly ClientRecord[],
): Map<string, PlaceView> {
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  return new Map(
    properties.map((property) => [
      property.id,
      {
        address: addressOf(property),
        clientName: clientNames.get(property.clientId) ?? null,
        clientId: property.clientId,
      },
    ]),
  );
}

/** Grava os filtros na URL de /inspections, sem empilhar histórico; o Next sincroniza o `useSearchParams`. */
function writeUrl(filters: InspectionFilters) {
  const search = filtersToSearch(filters);
  window.history.replaceState(window.history.state, "", search ? `${INSPECTIONS_HREF}?${search}` : INSPECTIONS_HREF);
}

/**
 * As vistorias do banco local para a lista de /inspections, com o imóvel, o cliente e o estado de sync. A linha abre a
 * tela de campo, ou o ConflictResolver quando a vistoria está em conflito. `remove` põe a exclusão na fila (ADR 0039).
 * A lista monta `LIST_PAGE_SIZE` linhas por vez; `showMore` monta mais uma página (ADR 0047). Ela lê o resumo de cada
 * vistoria e a fila, nunca as vistorias completas (ADR 0048): só fica pronta depois da primeira leitura da fila.
 *
 * A busca e os filtros (#175) começam da URL e são gravados nela a cada mudança, para o "Voltar" da tela de campo e do
 * laudo devolver a lista filtrada (`?voltar=`). O estado daqui é a fonte: a URL só espelha, então digitar não espera a
 * navegação. A busca filtra com `useDeferredValue`, e trocar qualquer filtro volta para a primeira página.
 */
export function useInspections() {
  const { store, ready, properties, clients, drafts, states, pending, outboxRead } =
    useLocalStore();
  const summaries = useInspectionSummaries(store);
  const params = useSearchParams();
  const [limit, setLimit] = useState(LIST_PAGE_SIZE);
  const [filters, setFiltersState] = useState(() => filtersFromParams(params));
  const query = useDeferredValue(filters.query);
  const applied = { ...filters, query };
  const places = placesOf(properties, clients);
  // A lista filtrada, como a URL a guarda: para onde o "Voltar" da tela de campo e do laudo leva.
  const back = isFiltered(filters) ? `${INSPECTIONS_HREF}?${filtersToSearch(filters)}` : null;
  const linkTo = (href: string) => (back ? withBack(href, back) : href);
  const apply = (next: InspectionFilters) => {
    setFiltersState(next);
    setLimit(LIST_PAGE_SIZE);
    writeUrl(next);
  };
  // As transações da fila que são de vistoria.
  const queued = new Map(
    [...pending].filter(
      ([, entry]) =>
        entry.mutationFnName === UPSERT_INSPECTION || entry.mutationFnName === DELETE_INSPECTION,
    ),
  );
  const listReady = ready && summaries.isReady && outboxRead;
  // Antes de pronta, a lista não mostra nada: montar as linhas seria custo à toa.
  const { rows, total, all } = listReady
    ? inspectionPage(summaries.data, queued, drafts, states, places, limit, applied)
    : { rows: [], total: 0, all: 0 };
  return {
    ready: listReady,
    /** O aparelho não tem nenhuma vistoria (o EmptyState de lista vazia, não o de busca sem resultado). */
    empty: all === 0,
    filters,
    /**
     * Troca a busca e os filtros. Trocar o cliente tira o imóvel escolhido, se ele não é desse cliente; escolher o
     * imóvel não mexe no cliente.
     */
    setFilters(next: Partial<InspectionFilters>) {
      const merged = { ...filters, ...next };
      if (
        next.clientId !== undefined &&
        merged.clientId !== null &&
        merged.propertyId !== null &&
        places.get(merged.propertyId)?.clientId !== merged.clientId
      ) {
        merged.propertyId = null;
      }
      apply(merged);
    },
    /** "Limpar filtros": a busca e todos os filtros. */
    clearFilters() {
      apply(NO_FILTERS);
    },
    /** "Limpar" do Sheet: os filtros, mantendo a busca. */
    clearSelects() {
      apply({ ...NO_FILTERS, query: filters.query });
    },
    /** A busca tem texto ou algum filtro está ligado. */
    filtered: isFiltered(filters),
    /** Quantos filtros estão ligados ("Filtros · N" no celular). */
    activeFilters: activeFilterCount(filters),
    /** Quantas vistorias casam com a busca e os filtros: "212 vistorias" ("Ver 212 vistorias" no Sheet). */
    matched: countLabel(total, total),
    // As opções do Cliente e do Imóvel saem só quando o Select abre: ordenar os 2.500 imóveis do spike 2 a cada
    // render (a lista renderiza a cada segundo) pesava no celular. O texto do escolhido sai direto do banco local.
    clientOptions: () => clientOptionsOf(clients),
    propertyOptions: () => propertyOptionsOf(places, filters.clientId),
    clientLabel: filters.clientId
      ? (clients.find((client) => client.id === filters.clientId)?.name ?? null)
      : null,
    propertyLabel: filters.propertyId ? (places.get(filters.propertyId)?.address ?? null) : null,
    kindOptions: KIND_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    periodOptions: PERIOD_OPTIONS,
    /** "6 vistorias", ou "50 de 10.000 vistorias" com a lista cortada. */
    count: countLabel(rows.length, total),
    /** Quantas vistorias ainda não estão na lista. */
    hidden: total - rows.length,
    showMore() {
      setLimit((current) => current + LIST_PAGE_SIZE);
    },
    rows: rows.map((row) => ({
      id: row.id,
      deletable: isDeletable(row),
      deleting: row.sync === "excluindo",
      deleteSubject: deletionSubject(row.address ?? "Imóvel fora deste aparelho", row.kindLabel),
      unsent: hasUnsent(row.sync),
      // Em conflito, a linha abre o ConflictResolver (Figma SyncBadge 25:1053).
      href: row.sync === "conflito" ? conflictHref(row.id) : linkTo(inspectionHref(row.id)),
      address: row.address ?? "Imóvel fora deste aparelho",
      clientName: row.clientName,
      kindLabel: row.kindLabel,
      statusLabel: row.statusLabel,
      completed: row.status === "completed",
      // O laudo só da conclusão confirmada: concluída e sem nada na fila (ADR 0054).
      reportHref:
        row.status === "completed" && row.sync === "sincronizado"
          ? linkTo(reportHref(row.id))
          : null,
      startedOn: dateOf(row.startedAt),
      startedMeta: startedLabel(row.startedAt),
      sync: row.sync,
    })),
    remove(id: string) {
      if (store) void deleteInspection(store, id);
    },
  };
}
