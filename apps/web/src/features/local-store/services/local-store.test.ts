import { afterEach, describe, expect, it, vi } from "vitest";

import { closeLocalDb, openLocalDb } from "@/shared/db/local-db";
import { startOutbox } from "@/shared/sync/outbox";

import { closeLocalStore, openLocalStore } from "./local-store";

// Um banco e uma outbox por usuário, a mesma para clients, properties e inspections: trocar de dono fecha os do anterior, e a
// fila dele não sai com o outro.

vi.mock("@/shared/db/local-db", () => ({
  openLocalDb: vi.fn<(ownerId: string) => Promise<object>>(async (ownerId) => ({ name: ownerId })),
  closeLocalDb: vi.fn<(ownerId: string) => Promise<void>>(async () => {}),
}));

vi.mock("@/features/clients/services/clients.collection", () => ({
  createClientsCollection: () => ({ cleanup: vi.fn<() => Promise<void>>(async () => {}) }),
}));

vi.mock("@/features/properties/services/properties.collection", () => ({
  createPropertiesCollection: () => ({ cleanup: vi.fn<() => Promise<void>>(async () => {}) }),
}));

vi.mock("@/features/inspections/services/inspections.collection", () => ({
  createInspectionsCollection: () => ({ cleanup: vi.fn<() => Promise<void>>(async () => {}) }),
}));

vi.mock("@/shared/sync/drafts", () => ({
  createDraftsCollection: () => ({ cleanup: vi.fn<() => Promise<void>>(async () => {}) }),
}));

vi.mock("@/shared/sync/outbox", async (original) => ({
  ...(await original<typeof import("@/shared/sync/outbox")>()),
  startOutbox: vi.fn<() => object>(() => ({
    waitForInit: async () => {},
    dispose: vi.fn<() => void>(),
    peekOutbox: async () => [],
    getRunningCount: () => 0,
  })),
}));

afterEach(async () => {
  await closeLocalStore();
  vi.clearAllMocks();
});

describe("openLocalStore", () => {
  it("abre o banco e a outbox do dono, uma vez só", async () => {
    const first = openLocalStore("ana");

    expect(openLocalStore("ana")).toBe(first);
    await first;
    expect(openLocalDb).toHaveBeenCalledExactlyOnceWith("ana");
    expect(vi.mocked(startOutbox).mock.calls[0]?.[0]).toMatchObject({ ownerId: "ana" });
  });

  it("uma outbox só, com as collections e as mutationFns de clients, properties e inspections", async () => {
    await openLocalStore("ana");

    expect(startOutbox).toHaveBeenCalledOnce();
    const [config] = vi.mocked(startOutbox).mock.calls[0]!;
    expect(Object.keys(config.collections).toSorted()).toEqual([
      "clients",
      "inspections",
      "properties",
    ]);
    expect(Object.keys(config.mutationFns).toSorted()).toEqual([
      "deleteInspection",
      "upsertClient",
      "upsertInspection",
      "upsertProperty",
    ]);
    // A exclusão compacta as escritas nunca tentadas da vistoria que estão antes dela (ADR 0039).
    expect([...(config.removals ?? [])]).toEqual(["deleteInspection"]);
  });

  it("trocar de dono fecha a outbox, as collections e o banco do anterior antes de abrir os do novo", async () => {
    const ana = await openLocalStore("ana");

    const bia = await openLocalStore("bia");

    expect(ana.outbox.dispose).toHaveBeenCalledOnce();
    expect(ana.clients.cleanup).toHaveBeenCalledOnce();
    expect(ana.properties.cleanup).toHaveBeenCalledOnce();
    expect(ana.inspections.cleanup).toHaveBeenCalledOnce();
    expect(ana.drafts.cleanup).toHaveBeenCalledOnce();
    expect(closeLocalDb).toHaveBeenCalledExactlyOnceWith("ana");
    expect(bia).not.toBe(ana);
    expect(vi.mocked(startOutbox).mock.calls.map(([config]) => config.ownerId)).toEqual([
      "ana",
      "bia",
    ]);
  });
});
