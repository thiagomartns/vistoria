import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LocalStore } from "@/features/local-store/services/local-store";

import { useInspectionRecord } from "./useInspectionRecord";

// Sem o array de dependências do useLiveQuery (o TanStack DB 1.0 o tirou), a consulta segue o `id` e o banco pelo que
// ela captura: trocar um ou outro na mesma tela tem de trazer a outra vistoria, nunca a anterior.

type Row = { id: string; name: string };

function storeWith(rows: Row[]) {
  const inspections = createCollection(
    localOnlyCollectionOptions<Row, string>({ getKey: (row) => row.id, initialData: rows }),
  );
  return { inspections } as unknown as LocalStore;
}

function render(store: LocalStore | undefined, id: string | null) {
  return renderHook((props) => useInspectionRecord(props.store, props.id), {
    initialProps: { store, id },
  });
}

describe("useInspectionRecord", () => {
  it("traz a vistoria do id, e a do outro id quando ele muda", async () => {
    const store = storeWith([
      { id: "v-ana", name: "Ana" },
      { id: "v-bia", name: "Bia" },
    ]);
    const { result, rerender } = render(store, "v-ana");
    await waitFor(() => expect(result.current.record).toMatchObject({ name: "Ana" }));

    rerender({ store, id: "v-bia" });

    await waitFor(() => expect(result.current.record).toMatchObject({ name: "Bia" }));
    expect(result.current.ready).toBe(true);
  });

  it("o mesmo id num banco novo (outro usuário) lê o banco novo", async () => {
    const { result, rerender } = render(storeWith([{ id: "v-1", name: "Da Ana" }]), "v-1");
    await waitFor(() => expect(result.current.record).toMatchObject({ name: "Da Ana" }));

    rerender({ store: storeWith([{ id: "v-1", name: "Da Bia" }]), id: "v-1" });

    await waitFor(() => expect(result.current.record).toMatchObject({ name: "Da Bia" }));
  });

  it("id que o aparelho não tem: pronto, sem vistoria", async () => {
    const { result } = render(storeWith([{ id: "v-ana", name: "Ana" }]), "v-nada");

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.record).toBeUndefined();
  });

  it("sem banco aberto, não fica pronto; sem id, fica", () => {
    expect(render(undefined, "v-ana").result.current).toEqual({ record: undefined, ready: false });
    expect(render(undefined, null).result.current).toEqual({ record: undefined, ready: true });
  });
});
