import { useState } from "react";

import { formatDocument } from "../schemas/client.schemas";
import { clientRows, matchesSearch } from "../services/clients.view";
import { useClientsStore } from "./useClientsStore";

/** A lista de /clients: as linhas do banco local, com o estado de sync de cada uma, e a busca local. */
export function useClients() {
  const { ready, clients, drafts, states } = useClientsStore();
  const [search, setSearch] = useState("");

  const all = clientRows(clients, drafts, states);
  return {
    ready,
    /** O aparelho não tem nenhum client (o EmptyState de lista vazia, não o de busca sem resultado). */
    empty: all.length === 0,
    /** As linhas que passam na busca, com o documento já mascarado para exibir. */
    rows: all
      .filter((row) => matchesSearch(row, search))
      .map((row) => ({ ...row, document: row.document && formatDocument(row.document) })),
    search,
    setSearch,
  };
}
