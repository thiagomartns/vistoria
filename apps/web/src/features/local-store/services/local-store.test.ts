import { afterEach, describe, expect, it, vi } from "vitest";

import { closeLocalDb, openLocalDb } from "@/shared/db/local-db";
import { deleteDeviceDatabases } from "@/shared/db/wipe";
import { startOutbox } from "@/shared/sync/outbox";
import { pullOnce } from "@/shared/sync/pull";
import { startPull } from "@/shared/sync/pull-triggers";

import { closeLocalStore, openLocalStore, pendingOf, wipeLocalStore } from "./local-store";

// Um banco, uma outbox e um pull por usuário, a mesma outbox para clients, properties, templates e inspections: trocar de dono fecha
// os do anterior, e a fila dele não sai com o outro.

/** O que a outbox e os rascunhos do próximo store aberto têm. */
const device = vi.hoisted(() => ({
  queued: [] as { id: string; mutations: object[]; createdAt: Date }[],
  drafts: [] as { status: string }[],
}));

const entry = (id: string) => ({ id, mutations: [], createdAt: new Date() });

vi.mock("@/shared/db/wipe", () => ({
  deleteDeviceDatabases: vi.fn<(ownerId: string) => Promise<void>>(async () => {}),
}));

vi.mock("@/shared/db/local-db", () => ({
  openLocalDb: vi.fn<(ownerId: string) => Promise<object>>(async (ownerId) => ({ name: ownerId })),
  closeLocalDb: vi.fn<(ownerId: string) => Promise<void>>(async () => {}),
}));

vi.mock("@/features/clients/services/clients.collection", () => ({
  createClientsCollection: () => ({
    cleanup: vi.fn<() => Promise<void>>(async () => {}),
    preload: vi.fn<() => Promise<void>>(async () => {}),
  }),
}));

vi.mock("@/features/properties/services/properties.collection", () => ({
  createPropertiesCollection: () => ({
    cleanup: vi.fn<() => Promise<void>>(async () => {}),
    preload: vi.fn<() => Promise<void>>(async () => {}),
  }),
}));

vi.mock("@/features/templates/services/templates.collection", () => ({
  createTemplatesCollection: () => ({
    cleanup: vi.fn<() => Promise<void>>(async () => {}),
    preload: vi.fn<() => Promise<void>>(async () => {}),
  }),
}));

vi.mock("@/features/inspections/services/inspections.collection", () => ({
  createInspectionCollections: () => ({
    inspections: {
      cleanup: vi.fn<() => Promise<void>>(async () => {}),
      preload: vi.fn<() => Promise<void>>(async () => {}),
    },
    inspectionSummaries: {
      cleanup: vi.fn<() => Promise<void>>(async () => {}),
      preload: vi.fn<() => Promise<void>>(async () => {}),
    },
  }),
}));

vi.mock("@/shared/sync/drafts", () => ({
  createDraftsCollection: () => ({
    cleanup: vi.fn<() => Promise<void>>(async () => {}),
    preload: vi.fn<() => Promise<void>>(async () => {}),
    get toArray() {
      return device.drafts;
    },
  }),
}));

vi.mock("@/shared/sync/pull", async (original) => ({
  ...(await original<typeof import("@/shared/sync/pull")>()),
  pullOnce: vi.fn<() => Promise<string>>(async () => "done"),
  createCursorsCollection: () => ({
    cleanup: vi.fn<() => Promise<void>>(async () => {}),
    preload: vi.fn<() => Promise<void>>(async () => {}),
  }),
  createSkipMarksCollection: () => ({
    cleanup: vi.fn<() => Promise<void>>(async () => {}),
    preload: vi.fn<() => Promise<void>>(async () => {}),
  }),
}));

vi.mock("@/shared/sync/pull-triggers", () => ({
  startPull: vi.fn<() => object>(() => ({
    trigger: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
  })),
}));

vi.mock("@/shared/sync/outbox", async (original) => ({
  ...(await original<typeof import("@/shared/sync/outbox")>()),
  startOutbox: vi.fn<() => object>(() => ({
    waitForInit: async () => {},
    dispose: vi.fn<() => void>(),
    peekOutbox: async () => device.queued,
    clearOutbox: vi.fn<() => Promise<void>>(async () => {
      device.queued = [];
    }),
    getRunningCount: () => 0,
  })),
}));

afterEach(async () => {
  await closeLocalStore();
  vi.clearAllMocks();
  device.queued = [];
  device.drafts = [];
});

describe("openLocalStore", () => {
  it("abre o banco e a outbox do dono, uma vez só", async () => {
    const first = openLocalStore("ana");

    expect(openLocalStore("ana")).toBe(first);
    await first;
    expect(openLocalDb).toHaveBeenCalledExactlyOnceWith("ana");
    expect(vi.mocked(startOutbox).mock.calls[0]?.[0]).toMatchObject({ ownerId: "ana" });
    expect(vi.mocked(startPull).mock.calls[0]?.[0]).toMatchObject({ ownerId: "ana" });
  });

  it("o pull carrega as collections, menos as vistorias, e puxa na ordem de criação: clientes, imóveis, roteiros e vistorias", async () => {
    const store = await openLocalStore("ana");

    await vi.mocked(startPull).mock.calls[0]![0].run();

    expect(store.clients.preload).toHaveBeenCalledOnce();
    expect(store.templates.preload).toHaveBeenCalledOnce();
    expect(store.drafts.preload).toHaveBeenCalledOnce();
    // A vistoria completa só carrega por id (ADR 0048): abrir a store inteira a cada ciclo era o custo do spike 2.
    expect(store.inspections.preload).not.toHaveBeenCalled();
    expect(store.inspectionSummaries.preload).not.toHaveBeenCalled();
    const [, entities] = vi.mocked(pullOnce).mock.calls[0]!;
    expect(entities.map((entity) => entity.name)).toEqual([
      "clients",
      "properties",
      "templates",
      "inspections",
    ]);
    expect(entities[2]!.store).toBe(store.templates);
    expect(entities[3]!.store).toBe(store.inspections);
  });

  it("uma outbox só, com as collections e as mutationFns de clients, properties, templates e inspections", async () => {
    await openLocalStore("ana");

    expect(startOutbox).toHaveBeenCalledOnce();
    const [config] = vi.mocked(startOutbox).mock.calls[0]!;
    expect(Object.keys(config.collections).toSorted()).toEqual([
      "clients",
      "inspections",
      "properties",
      "templates",
    ]);
    expect(Object.keys(config.mutationFns).toSorted()).toEqual([
      "deleteInspection",
      "upsertClient",
      "upsertInspection",
      "upsertProperty",
      "upsertTemplate",
    ]);
    // A exclusão compacta as escritas nunca tentadas da vistoria que estão antes dela (ADR 0039).
    expect([...(config.removals ?? [])]).toEqual(["deleteInspection"]);
  });

  it("trocar de dono fecha o pull, a outbox, as collections e o banco do anterior antes de abrir os do novo", async () => {
    const ana = await openLocalStore("ana");

    const bia = await openLocalStore("bia");

    expect(ana.pull.dispose).toHaveBeenCalledOnce();
    expect(ana.outbox.dispose).toHaveBeenCalledOnce();
    expect(ana.clients.cleanup).toHaveBeenCalledExactlyOnceWith({ dependents: true });
    expect(ana.properties.cleanup).toHaveBeenCalledExactlyOnceWith({ dependents: true });
    expect(ana.templates.cleanup).toHaveBeenCalledExactlyOnceWith({ dependents: true });
    expect(ana.inspections.cleanup).toHaveBeenCalledExactlyOnceWith({ dependents: true });
    expect(ana.inspectionSummaries.cleanup).toHaveBeenCalledOnce();
    expect(ana.drafts.cleanup).toHaveBeenCalledExactlyOnceWith({ dependents: true });
    expect(ana.cursors.cleanup).toHaveBeenCalledExactlyOnceWith({ dependents: true });
    expect(ana.skipped.cleanup).toHaveBeenCalledExactlyOnceWith({ dependents: true });
    expect(closeLocalDb).toHaveBeenCalledExactlyOnceWith("ana");
    expect(bia).not.toBe(ana);
    expect(vi.mocked(startOutbox).mock.calls.map(([config]) => config.ownerId)).toEqual([
      "ana",
      "bia",
    ]);
  });
});

describe("pendingOf", () => {
  it("conta a fila da outbox e os rascunhos recusados ou em conflito, não o rascunho em andamento", async () => {
    device.queued = [entry("tx-1"), entry("tx-2")];
    device.drafts = [{ status: "conflict" }, { status: "rejected" }, { status: "draft" }];

    expect(await pendingOf("ana")).toBe(4);
  });

  it("sem nada, zero", async () => {
    expect(await pendingOf("ana")).toBe(0);
  });
});

describe("wipeLocalStore", () => {
  it("com o banco aberto: esvazia a outbox antes de fechar tudo e só então apaga os bancos", async () => {
    device.queued = [entry("tx-1")];
    const ana = await openLocalStore("ana");
    const order: string[] = [];
    vi.mocked(ana.outbox.clearOutbox).mockImplementation(async () => {
      order.push("clearOutbox");
    });
    vi.mocked(ana.outbox.dispose).mockImplementation(() => order.push("dispose"));
    vi.mocked(closeLocalDb).mockImplementation(async () => {
      order.push("closeLocalDb");
    });
    vi.mocked(deleteDeviceDatabases).mockImplementation(async () => {
      order.push("deleteDeviceDatabases");
    });

    await wipeLocalStore("ana");

    expect(order).toEqual(["clearOutbox", "dispose", "closeLocalDb", "deleteDeviceDatabases"]);
    expect(ana.pull.dispose).toHaveBeenCalledOnce();
    expect(deleteDeviceDatabases).toHaveBeenCalledExactlyOnceWith("ana");
  });

  it("depois de apagar, abrir de novo é um banco novo", async () => {
    const ana = await openLocalStore("ana");

    await wipeLocalStore("ana");

    expect(await openLocalStore("ana")).not.toBe(ana);
  });

  it("com o banco de outro aberto: não fecha o dele, só apaga os bancos do anterior", async () => {
    const bia = await openLocalStore("bia");

    await wipeLocalStore("ana");

    expect(bia.outbox.dispose).not.toHaveBeenCalled();
    expect(deleteDeviceDatabases).toHaveBeenCalledExactlyOnceWith("ana");
    expect(await openLocalStore("bia")).toBe(bia);
  });
});
