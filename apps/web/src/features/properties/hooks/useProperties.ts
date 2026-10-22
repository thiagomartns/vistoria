import { useState } from "react";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import { TYPE_OPTIONS } from "../schemas/property.schemas";
import {
  type PropertyFilters,
  clientOptionsOf,
  matchesFilters,
  matchesSearch,
  propertyRows,
} from "../services/properties.view";

const NO_FILTERS: PropertyFilters = { clientId: null, type: null };

/** A lista de /properties: as linhas do banco local, com o nome do cliente e o estado de sync, a busca e os filtros. */
export function useProperties() {
  const { ready, clients, properties, drafts, states } = useLocalStore();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);

  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const all = propertyRows(properties, drafts, states, clientNames);
  return {
    ready,
    /** O aparelho não tem nenhum imóvel (o EmptyState de lista vazia, não o de busca sem resultado). */
    empty: all.length === 0,
    rows: all
      .filter((row) => matchesSearch(row, search) && matchesFilters(row, filters))
      .map((row) => ({
        id: row.id,
        address: row.address,
        clientName: row.clientName,
        typeLabel: row.typeLabel,
        place: row.place,
        sync: row.sync,
      })),
    search,
    setSearch,
    filters,
    setFilters,
    /** Quantos filtros estão ligados ("Filtros · N" no celular). */
    activeFilters: Object.values(filters).filter((value) => value !== null).length,
    clientOptions: clientOptionsOf(clients),
    typeOptions: TYPE_OPTIONS,
  };
}
