import { useState } from "react";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { propertyCountByClient } from "@/features/properties/services/properties.view";

import { formatDocument } from "../schemas/client.schemas";
import { clientRows, matchesSearch } from "../services/clients.view";

/**
 * A lista de /clients: as linhas do banco local, com o estado de sync e a contagem de imóveis de cada uma, e a busca
 * local.
 */
export function useClients() {
  const { ready, clients, properties, drafts, states } = useLocalStore();
  const [search, setSearch] = useState("");

  const all = clientRows(clients, drafts, states);
  const counts = propertyCountByClient(properties);
  return {
    ready,
    /** O aparelho não tem nenhum client (o EmptyState de lista vazia, não o de busca sem resultado). */
    empty: all.length === 0,
    /** As linhas que passam na busca, com o documento já mascarado para exibir. */
    rows: all
      .filter((row) => matchesSearch(row, search))
      .map((row) => ({
        ...row,
        document: row.document && formatDocument(row.document),
        properties: counts.get(row.id) ?? 0,
      })),
    search,
    setSearch,
  };
}
