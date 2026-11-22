import { useState } from "react";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { LIST_PAGE_SIZE, countLabel } from "@/shared/list-page";

import { TYPE_OPTIONS } from "../schemas/property.schemas";
import {
  type PropertyFilters,
  clientOptionsOf,
  matchesFilters,
  matchesSearch,
  propertyRows,
} from "../services/properties.view";

const NO_FILTERS: PropertyFilters = { clientId: null, type: null };
const NOUN = { one: "imóvel", many: "imóveis" };

/**
 * A lista de /properties: as linhas do banco local, com o nome do cliente e o estado de sync, a busca e os filtros. A
 * busca e os filtros correm sobre todos os imóveis do aparelho; a lista monta `LIST_PAGE_SIZE` linhas por vez, e
 * `showMore` monta mais uma página (#223). Mudar a busca ou um filtro volta para a primeira página.
 */
export function useProperties() {
  const { ready, clients, properties, drafts, states } = useLocalStore();
  const [search, setSearchState] = useState("");
  const [filters, setFiltersState] = useState(NO_FILTERS);
  const [limit, setLimit] = useState(LIST_PAGE_SIZE);

  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const all = propertyRows(properties, drafts, states, clientNames);
  const matched = all.filter((row) => matchesSearch(row, search) && matchesFilters(row, filters));
  const page = matched.slice(0, limit);
  return {
    ready,
    /** O aparelho não tem nenhum imóvel (o EmptyState de lista vazia, não o de busca sem resultado). */
    empty: all.length === 0,
    rows: page.map((row) => ({
      id: row.id,
      address: row.address,
      clientName: row.clientName,
      typeLabel: row.typeLabel,
      place: row.place,
      sync: row.sync,
    })),
    /** "12 imóveis", ou "50 de 2.500 imóveis" com a lista cortada. */
    count: countLabel(page.length, matched.length, NOUN),
    /** Quantos imóveis que passam na busca e nos filtros ainda não estão na lista. */
    hidden: matched.length - page.length,
    showMore() {
      setLimit((current) => current + LIST_PAGE_SIZE);
    },
    search,
    setSearch(next: string) {
      setSearchState(next);
      setLimit(LIST_PAGE_SIZE);
    },
    filters,
    setFilters(next: PropertyFilters) {
      setFiltersState(next);
      setLimit(LIST_PAGE_SIZE);
    },
    /** Quantos filtros estão ligados ("Filtros · N" no celular). */
    activeFilters: Object.values(filters).filter((value) => value !== null).length,
    clientOptions: clientOptionsOf(clients),
    typeOptions: TYPE_OPTIONS,
  };
}
