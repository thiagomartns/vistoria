import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LocalStore } from "@/features/local-store/services/local-store";

import { useInspectionRecords } from "./useInspectionRecords";

// As saídas do imóvel lidas por id na Nova vistoria (#184): a consulta segue os ids que ela captura, como a de um id só.

type Row = { id: string; name: string };

function storeWith(rows: Row[]) {
  const inspections = createCollection(
    localOnlyCollectionOptions<Row, string>({ getKey: (row) => row.id, initialData: rows }),
  );
  return { inspections } as unknown as LocalStore;
}

function render(store: LocalStore | undefined, ids: readonly string[]) {
  return renderHook((props) => useInspectionRecords(props.store, props.ids), {
    initialProps: { store, ids },
  });
}

const names = (records: readonly unknown[]) => (records as Row[]).map((row) => row.name).toSorted();

describe("useInspectionRecords", () => {
  it("traz só as vistorias dos ids, e as dos outros ids quando eles mudam", async () => {
    const store = storeWith([
      { id: "v-ana", name: "Ana" },
      { id: "v-bia", name: "Bia" },
      { id: "v-caio", name: "Caio" },
    ]);
    const { result, rerender } = render(store, ["v-ana", "v-caio", "v-nada"]);
    await waitFor(() => expect(names(result.current.records)).toEqual(["Ana", "Caio"]));
    expect(result.current.ready).toBe(true);

    rerender({ store, ids: ["v-bia"] });

    await waitFor(() => expect(names(result.current.records)).toEqual(["Bia"]));
  });

  it("sem ids, pronto e vazio, mesmo sem banco; com ids e sem banco, não fica pronto", () => {
    expect(render(undefined, []).result.current).toEqual({ records: [], ready: true });
    expect(render(undefined, ["v-ana"]).result.current).toEqual({ records: [], ready: false });
  });
});
