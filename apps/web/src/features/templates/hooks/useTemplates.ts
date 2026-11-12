import { useState } from "react";

import { useLocalStore } from "@/features/local-store/hooks/useLocalStore";

import { matchesSearch, templateRows } from "../services/templates.view";

/** A lista de /templates: os roteiros do banco local, com as contagens e o estado de sync, e a busca pelo nome. */
export function useTemplates() {
  const { ready, templates, drafts, states } = useLocalStore();
  const [search, setSearch] = useState("");

  const all = templateRows(templates, drafts, states);
  return {
    ready,
    /** O aparelho não tem nenhum roteiro (o EmptyState de lista vazia, não o de busca sem resultado). */
    empty: all.length === 0,
    rows: all
      .filter((row) => matchesSearch(row, search))
      .map(({ id, name, roomCount, itemCount, sync }) => ({
        id,
        name,
        roomCount,
        itemCount,
        sync,
      })),
    search,
    setSearch,
  };
}
