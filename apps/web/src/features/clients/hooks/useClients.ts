import { useState } from "react";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";
import { propertyCountByClient } from "@/features/properties/services/properties.view";
import { LIST_PAGE_SIZE, countLabel } from "@/shared/list-page";

import { formatDocument, formatPhone } from "../schemas/client.schemas";
import { clientRows, matchesSearch } from "../services/clients.view";

const NOUN = { one: "cliente", many: "clientes" };

/**
 * A lista de /clients: as linhas do banco local, com o estado de sync e a contagem de imóveis de cada uma, e a busca
 * local. A busca corre sobre todos os clients do aparelho; a lista monta `LIST_PAGE_SIZE` linhas por vez, e
 * `showMore` monta mais uma página (#223). Mudar a busca volta para a primeira página.
 */
export function useClients() {
  const { ready, clients, properties, drafts, states } = useLocalStore();
  const [search, setSearchState] = useState("");
  const [limit, setLimit] = useState(LIST_PAGE_SIZE);

  const all = clientRows(clients, drafts, states);
  const matched = all.filter((row) => matchesSearch(row, search));
  const page = matched.slice(0, limit);
  const counts = propertyCountByClient(properties);
  return {
    ready,
    /** O aparelho não tem nenhum client (o EmptyState de lista vazia, não o de busca sem resultado). */
    empty: all.length === 0,
    /** A página de linhas que passam na busca, com o documento e o telefone já mascarados para exibir. */
    rows: page.map((row) => ({
      ...row,
      document: row.document && formatDocument(row.document),
      phone: row.phone && formatPhone(row.phone),
      properties: counts.get(row.id) ?? 0,
    })),
    /** "12 clientes", ou "50 de 500 clientes" com a lista cortada. */
    count: countLabel(page.length, matched.length, NOUN),
    /** Quantos clients que passam na busca ainda não estão na lista. */
    hidden: matched.length - page.length,
    showMore() {
      setLimit((current) => current + LIST_PAGE_SIZE);
    },
    search,
    setSearch(next: string) {
      setSearchState(next);
      setLimit(LIST_PAGE_SIZE);
    },
  };
}
