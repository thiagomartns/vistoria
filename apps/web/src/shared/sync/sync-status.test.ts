import { afterEach, describe, expect, it, vi } from "vitest";

import type { Outbox } from "./outbox";
import {
  recordSyncSuccess,
  resetSyncStatus,
  retryNow,
  syncStatusStore,
  trackOutbox,
} from "./sync-status";

function fakeOutbox(entries: object[], running = 0) {
  const notifyOnline = vi.fn<() => void>();
  const outbox = {
    peekOutbox: vi.fn<() => Promise<object[]>>(async () => entries),
    getRunningCount: () => running,
    getOnlineDetector: () => ({ notifyOnline }),
  } as unknown as Outbox;
  return { outbox, notifyOnline };
}

const transaction = (id: string, createdAt: Date) => ({
  id,
  mutationFnName: "upsertClient",
  mutations: [{ modified: { id: "c1", name: "Maria" } }],
  createdAt,
  retryCount: 0,
  nextAttemptAt: 0,
});

afterEach(() => {
  resetSyncStatus();
  vi.restoreAllMocks();
});

describe("syncStatusStore", () => {
  it("começa online e acompanha os eventos de rede enquanto alguém assina", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = syncStatusStore.subscribe(listener);

    window.dispatchEvent(new Event("offline"));
    expect(syncStatusStore.getSnapshot().online).toBe(false);
    window.dispatchEvent(new Event("online"));
    expect(syncStatusStore.getSnapshot().online).toBe(true);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    window.dispatchEvent(new Event("offline"));
    expect(syncStatusStore.getSnapshot().online).toBe(true);
  });

  it("lê a outbox acompanhada, da transação mais antiga para a mais nova", async () => {
    const older = new Date(2026, 9, 22, 10, 0);
    const newer = new Date(2026, 9, 22, 11, 0);
    const { outbox } = fakeOutbox([transaction("b", newer), transaction("a", older)], 1);

    trackOutbox(outbox);

    await vi.waitFor(() => expect(syncStatusStore.getSnapshot().entries).toHaveLength(2));
    const { entries, running } = syncStatusStore.getSnapshot();
    expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(entries[0]).toMatchObject({
      mutationFnName: "upsertClient",
      record: { id: "c1", name: "Maria" },
      createdAt: older,
    });
    expect(running).toBe(1);
  });

  it("guarda o último envio confirmado", () => {
    const at = new Date(2026, 9, 22, 14, 30);

    recordSyncSuccess(at);

    expect(syncStatusStore.getSnapshot().lastSyncedAt).toBe(at);
  });

  it("Tentar agora acorda a fila da outbox acompanhada", () => {
    const { outbox, notifyOnline } = fakeOutbox([]);
    trackOutbox(outbox);

    retryNow();

    expect(notifyOnline).toHaveBeenCalledOnce();
  });

  it("no servidor (prerender) o estado é o inicial", () => {
    expect(syncStatusStore.getServerSnapshot()).toEqual({
      online: true,
      entries: [],
      running: 0,
      lastSyncedAt: null,
    });
  });
});
