import { createCollection, createIndexedDB, createLiveQueryCollection } from "@tanstack/db";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { syncedCollectionOptions } from "./local-db";

// O `close()` do banco local (local-store.ts) fecha as collections com `{ dependents: true }`: no TanStack DB 1.0, o
// cleanup sem isso recusa enquanto uma live query lê a collection, e a tela ainda montada na troca de usuário segura uma.

type Row = { id: string; version: string; name: string };

async function readClients() {
  const db = await createIndexedDB({
    name: `cleanup-${crypto.randomUUID()}`,
    version: 1,
    stores: ["clients"],
    idbFactory: new IDBFactory(),
  });
  const clients = createCollection(syncedCollectionOptions<Row>(db, "clients"));
  await clients.preload();
  await clients.insert({ id: "c-ana", version: "AAAAAAAAAAE=", name: "Ana" }).when("settled");
  const screen = createLiveQueryCollection((q) => q.from({ client: clients }));
  const subscription = screen.subscribeChanges(() => {});
  await screen.preload();
  return { clients, screen, subscription };
}

describe("cleanup com uma tela lendo", () => {
  it("sem dependents, recusa", async () => {
    const { clients, subscription } = await readClients();

    await expect(clients.cleanup()).rejects.toThrow(/subscriber/i);

    subscription.unsubscribe();
  });

  it("com dependents, termina a live query e fecha", async () => {
    const { clients, screen, subscription } = await readClients();

    await clients.cleanup({ dependents: true });

    expect(clients.status).toBe("cleaned-up");
    expect(screen.status).toBe("cleaned-up");
    subscription.unsubscribe();
  });
});
