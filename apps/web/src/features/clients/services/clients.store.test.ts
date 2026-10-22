import { afterEach, describe, expect, it, vi } from "vitest";

import { closeLocalDb, openLocalDb } from "@/shared/db/local-db";
import { startOutbox } from "@/shared/sync/outbox";

import { closeClientsStore, openClientsStore } from "./clients.sync";

// Um banco e uma outbox por usuário: trocar de dono fecha os do anterior, e a fila dele não sai com o outro.

vi.mock("@/shared/db/local-db", () => ({
  openLocalDb: vi.fn<(ownerId: string) => Promise<object>>(async (ownerId) => ({ name: ownerId })),
  closeLocalDb: vi.fn<(ownerId: string) => Promise<void>>(async () => {}),
}));

vi.mock("./clients.collection", () => ({
  createClientsCollection: () => ({ cleanup: vi.fn<() => Promise<void>>(async () => {}) }),
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
  await closeClientsStore();
  vi.clearAllMocks();
});

describe("openClientsStore", () => {
  it("abre o banco e a outbox do dono, uma vez só", async () => {
    const first = openClientsStore("ana");

    expect(openClientsStore("ana")).toBe(first);
    await first;
    expect(openLocalDb).toHaveBeenCalledExactlyOnceWith("ana");
    expect(vi.mocked(startOutbox).mock.calls[0]?.[0]).toMatchObject({ ownerId: "ana" });
  });

  it("trocar de dono fecha a outbox, as collections e o banco do anterior antes de abrir os do novo", async () => {
    const ana = await openClientsStore("ana");

    const bia = await openClientsStore("bia");

    expect(ana.outbox.dispose).toHaveBeenCalledOnce();
    expect(ana.clients.cleanup).toHaveBeenCalledOnce();
    expect(ana.drafts.cleanup).toHaveBeenCalledOnce();
    expect(closeLocalDb).toHaveBeenCalledExactlyOnceWith("ana");
    expect(bia).not.toBe(ana);
    expect(vi.mocked(startOutbox).mock.calls.map(([config]) => config.ownerId)).toEqual([
      "ana",
      "bia",
    ]);
  });
});
