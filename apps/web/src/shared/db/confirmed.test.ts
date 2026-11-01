import { createCollection, createIndexedDB } from "@tanstack/db";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { readConfirmed, syncedCollectionOptions } from "./local-db";

// A leitura por chave da store confirmada (ADR 0047) contra a collection IndexedDB de verdade, num IndexedDB em
// memória: o `readConfirmed` acha cada registro onde a collection o gravou, e lê só o que foi pedido.

type Row = { id: string; version: string; name: string };

async function collectionWith(rows: Row[]) {
  const db = await createIndexedDB({
    name: `confirmed-${crypto.randomUUID()}`,
    version: 1,
    stores: ["clients", "properties"],
    idbFactory: new IDBFactory(),
  });
  const clients = createCollection(syncedCollectionOptions<Row>(db, "clients"));
  await clients.preload();
  for (const row of rows) await clients.insert(row).isPersisted.promise;
  return { db, clients };
}

describe("readConfirmed", () => {
  const ana = { id: "c-ana", version: "AAAAAAAAAAE=", name: "Ana" };
  const bia = { id: "c-bia", version: "AAAAAAAAAAI=", name: "Bia" };
  const caio = { id: "c-caio", version: "AAAAAAAAAAM=", name: "Caio" };

  it("lê só as chaves pedidas, como a collection as gravou; a que a store não tem fica de fora", async () => {
    const { db, clients } = await collectionWith([ana, bia, caio]);

    expect(await readConfirmed<Row>(db, "clients", [caio.id, "c-outro", ana.id])).toEqual([
      caio,
      ana,
    ]);
    expect(await clients.utils.readConfirmed([bia.id])).toEqual([bia]);
    expect(await clients.utils.readConfirmed([])).toEqual([]);
    // O mesmo que o `exportData`, que lê a store inteira.
    expect(await clients.utils.exportData()).toEqual(expect.arrayContaining([ana, bia, caio]));
    db.close();
  });

  it("acompanha a store: o registro atualizado volta novo, e o excluído some", async () => {
    const { db, clients } = await collectionWith([ana, bia]);

    await clients.update(ana.id, (draft) => {
      draft.name = "Ana Maria";
    }).isPersisted.promise;
    await clients.delete(bia.id).isPersisted.promise;

    expect(await clients.utils.readConfirmed([ana.id, bia.id])).toEqual([
      { ...ana, name: "Ana Maria" },
    ]);
    db.close();
  });
});
