import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import { type Outbox, enqueue, startOutbox } from "@/shared/sync/outbox";

import type { InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import {
  DELETE_INSPECTION,
  UPSERT_INSPECTION,
  deleteInspection,
  deleteInspectionMutation,
  saveInspection,
  upsertInspectionMutation,
} from "./inspections.sync";

// A exclusão da vistoria na outbox única (ADR 0039), com o executor de verdade e as mutationFns de verdade, contra um
// servidor falso que anota cada requisição: o `DELETE` sai com If-Match da versão confirmada, a edição pendente nunca
// chega ao servidor depois dele, e a vistoria que o servidor nunca aceitou sai do aparelho sem requisição.

let canSend = true;

vi.mock("@/shared/auth/session", () => ({
  canSendAs: () => canSend,
  sessionStore: { subscribe: () => () => {} },
  expireSession: () => {},
}));

// Web Locks mínimo, como em outbox.order.test.ts: sem líder, a outbox não guarda a fila.
function fakeLocks() {
  const held = new Map<string, Promise<unknown>>();
  return {
    async request(
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => unknown,
    ) {
      if (options.ifAvailable) return callback(held.has(name) ? null : { name });
      while (held.has(name)) await held.get(name)!.catch(() => {});
      const holding = Promise.resolve().then(() => callback({ name }));
      held.set(name, holding);
      try {
        return await holding;
      } finally {
        held.delete(name);
      }
    },
  };
}

Object.defineProperty(navigator, "locks", { value: fakeLocks(), configurable: true });

const PROPERTY_ID = "01a16032-2dfb-77de-84a2-1f165bdd993f";

const problem = (slug: string, status: number, extra: Record<string, unknown> = {}) =>
  Response.json(
    {
      type: `urn:vistoria:problem:${slug}`,
      title: slug,
      status,
      detail: slug,
      traceId: "00-trace",
      ...extra,
    },
    { status, headers: { "content-type": "application/problem+json" } },
  );

type PutAnswer = "ok" | "network" | "conflict";

/**
 * O servidor falso. Cada `PUT` responde pelo `put` da vez (200 com a versão "v2", falha de rede ou 412) e cada
 * `DELETE`, pelo `remove` (204 ou 412). Anota o método, a chave e o If-Match de cada requisição que chegou.
 */
function fakeServer() {
  const sent: { method: string; key: string | null; ifMatch: string | null }[] = [];
  const answers = { put: "ok" as PutAnswer, remove: 204 as 204 | 412 };
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      const request = input as Request;
      const id = new URL(request.url).pathname.split("/")[4]!;
      if (request.method === "PUT" && answers.put === "network") {
        answers.put = "ok";
        throw new TypeError("Failed to fetch");
      }
      sent.push({
        method: request.method,
        key: request.headers.get("Idempotency-Key"),
        ifMatch: request.headers.get("If-Match"),
      });
      if (request.method === "DELETE") {
        return answers.remove === 204
          ? new Response(null, { status: 204 })
          : problem("version-conflict", 412, { current: { id, version: "v9" } });
      }
      const body = await request.json();
      if (answers.put === "conflict") {
        return problem("version-conflict", 412, { current: { ...body, id, version: "v9" } });
      }
      return Response.json({ ...body, id, version: "v2" });
    },
  });
  return { client, sent, answers };
}

let open: Outbox[] = [];

afterEach(() => {
  for (const outbox of open) outbox.dispose();
  open = [];
  canSend = true;
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * A collection de vistorias com a store confirmada por baixo, como a IndexedDB do app: `exportData` lê só o que o
 * servidor confirmou, e `acceptMutations` grava (ou apaga) ali e na collection.
 */
function localInspections() {
  const confirmed = new Map<string, InspectionRecord>();
  const inspections = createCollection(
    localOnlyCollectionOptions<InspectionRecord, string>({
      id: "inspections",
      getKey: (row) => row.id,
    }),
  );
  const accept = inspections.utils.acceptMutations;
  Object.assign(inspections.utils, {
    exportData: async () => [...confirmed.values()],
    acceptMutations: async (transaction: {
      mutations: { type: string; modified: InspectionRecord }[];
    }) => {
      for (const { type, modified } of transaction.mutations) {
        if (type === "delete") confirmed.delete(modified.id);
        else confirmed.set(modified.id, modified);
      }
      accept(transaction as never);
    },
  });
  const drafts = new Map<string, Record<string, unknown>>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: { id: string }) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: Record<string, unknown>) => void) =>
      change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  return {
    confirmed,
    drafts,
    inspections: inspections as unknown as InspectionsCollection,
    draftsCollection,
  };
}

async function start(server: ReturnType<typeof fakeServer>, local = localInspections()) {
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { inspections: local.inspections },
    mutationFns: {
      [UPSERT_INSPECTION]: upsertInspectionMutation(
        local.inspections,
        local.draftsCollection,
        server.client,
      ),
      [DELETE_INSPECTION]: deleteInspectionMutation(
        local.inspections,
        local.draftsCollection,
        server.client,
      ),
    },
    removals: new Set([DELETE_INSPECTION]),
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  const store = { inspections: local.inspections, drafts: local.draftsCollection, outbox };
  /** Uma vistoria que o servidor já aceitou, na versão "v1". */
  const known = () => {
    const record = { ...newMoveInInspection(PROPERTY_ID), version: "v1" };
    local.confirmed.set(record.id, record);
    local.inspections.insert(record);
    return record;
  };
  /** Marca a condição do primeiro item e põe a vistoria na fila. */
  const edit = (record: InspectionRecord, condition: "good" | "fair") => {
    const { version: _version, ...values } = record;
    const [room, ...rooms] = values.rooms;
    const [item, ...items] = room!.items;
    saveInspection(store, {
      ...values,
      rooms: [{ ...room!, items: [{ ...item!, condition }, ...items] }, ...rooms],
    });
  };
  return { ...local, outbox, store, known, edit };
}

const reconnect = (outbox: Outbox) => {
  canSend = true;
  outbox.getOnlineDetector().notifyOnline();
};

const drained = (outbox: Outbox) =>
  vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), { timeout: 10_000 });

/** Um tique entre duas escritas: o createdAt é em ms, e a compactação só vale com um estritamente maior. */
const tick = () => new Promise((done) => setTimeout(done, 5));

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("exclusão da vistoria na outbox", () => {
  it("online: DELETE com If-Match da versão confirmada e chave v7; a vistoria fica 'Excluindo' até o 204 e então some", async () => {
    const server = fakeServer();
    const local = await start(server);
    const record = local.known();
    local.drafts.set(record.id, { id: record.id, entity: "inspection", status: "draft", step: 2 });
    canSend = false;

    await deleteInspection(local.store, record.id);

    expect(local.inspections.get(record.id)).toMatchObject({ id: record.id, deleting: true });
    expect(local.drafts.has(record.id)).toBe(false);
    reconnect(local.outbox);
    await drained(local.outbox);
    expect(server.sent).toEqual([
      { method: "DELETE", key: expect.stringMatching(UUID_V7), ifMatch: '"v1"' },
    ]);
    expect(local.confirmed.has(record.id)).toBe(false);
    expect(local.inspections.has(record.id)).toBe(false);
  });

  it("offline: nada sai até a rede voltar; aí sai o DELETE e a vistoria some", async () => {
    canSend = false;
    const server = fakeServer();
    const local = await start(server);
    const record = local.known();

    await deleteInspection(local.store, record.id);
    await new Promise((done) => setTimeout(done, 300));

    expect(server.sent).toEqual([]);
    expect(local.inspections.get(record.id)?.deleting).toBe(true);
    reconnect(local.outbox);
    await drained(local.outbox);
    expect(server.sent.map(({ method }) => method)).toEqual(["DELETE"]);
    expect(local.inspections.has(record.id)).toBe(false);
  });

  it("edição nunca enviada antes da exclusão: é compactada, e o servidor só vê o DELETE", async () => {
    canSend = false;
    const server = fakeServer();
    const local = await start(server);
    const record = local.known();

    local.edit(record, "good");
    await tick();
    await deleteInspection(local.store, record.id);
    await vi.waitFor(async () => expect(await local.outbox.peekOutbox()).toHaveLength(2));
    reconnect(local.outbox);
    await drained(local.outbox);

    expect(server.sent).toEqual([{ method: "DELETE", key: expect.any(String), ifMatch: '"v1"' }]);
    expect(local.inspections.has(record.id)).toBe(false);
  });

  it("edição já tentada: sai de novo com a mesma chave, antes do DELETE, que leva a versão que ela devolveu", async () => {
    const server = fakeServer();
    server.answers.put = "network";
    const local = await start(server);
    const record = local.known();

    local.edit(record, "good");
    await vi.waitFor(async () => expect((await local.outbox.peekOutbox())[0]?.retryCount).toBe(1), {
      timeout: 5_000,
    });
    canSend = false;
    await deleteInspection(local.store, record.id);
    const [put] = await local.outbox.peekOutbox();
    reconnect(local.outbox);
    await drained(local.outbox);

    expect(server.sent).toEqual([
      { method: "PUT", key: put?.idempotencyKey, ifMatch: '"v1"' },
      { method: "DELETE", key: expect.any(String), ifMatch: '"v2"' },
    ]);
  });

  it("PUT anterior com 412 e a exclusão na fila: sem merge reenviado nem conflito, e o DELETE é o último a sair", async () => {
    const server = fakeServer();
    server.answers.put = "network";
    const local = await start(server);
    const record = local.known();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    local.edit(record, "good");
    await vi.waitFor(async () => expect((await local.outbox.peekOutbox())[0]?.retryCount).toBe(1), {
      timeout: 5_000,
    });
    canSend = false;
    await deleteInspection(local.store, record.id);
    server.answers.put = "conflict";
    reconnect(local.outbox);
    await drained(local.outbox);
    await new Promise((done) => setTimeout(done, 300));

    expect(server.sent.map(({ method }) => method)).toEqual(["PUT", "DELETE"]);
    expect(server.sent[1]?.ifMatch).toBe('"v1"');
    expect(local.drafts.has(record.id)).toBe(false);
    expect(local.inspections.has(record.id)).toBe(false);
  });

  it("criada offline e nunca enviada: some na hora, e a volta da rede não manda requisição nenhuma", async () => {
    canSend = false;
    const server = fakeServer();
    const local = await start(server);
    const inspection = newMoveInInspection(PROPERTY_ID);
    enqueue(local.outbox, UPSERT_INSPECTION, () => local.inspections.insert(inspection));
    await tick();

    await deleteInspection(local.store, inspection.id);

    expect(local.inspections.has(inspection.id)).toBe(false);
    reconnect(local.outbox);
    await drained(local.outbox);
    await new Promise((done) => setTimeout(done, 300));
    expect(server.sent).toEqual([]);
    expect(local.confirmed.size).toBe(0);
  });

  it("criação recusada, só no rascunho: o rascunho some e nada vai para a fila", async () => {
    const server = fakeServer();
    const local = await start(server);
    const inspection = newMoveInInspection(PROPERTY_ID);
    local.drafts.set(inspection.id, {
      id: inspection.id,
      entity: "inspection",
      status: "rejected",
      data: inspection,
    });

    await deleteInspection(local.store, inspection.id);

    expect(local.drafts.has(inspection.id)).toBe(false);
    expect(await local.outbox.peekOutbox()).toEqual([]);
    expect(server.sent).toEqual([]);
  });

  it("com a exclusão na fila, salvar a vistoria não põe nada na fila", async () => {
    canSend = false;
    const server = fakeServer();
    const local = await start(server);
    const record = local.known();

    await deleteInspection(local.store, record.id);
    local.edit(record, "fair");

    const queued = await local.outbox.peekOutbox();
    expect(queued.map(({ mutationFnName }) => mutationFnName)).toEqual([DELETE_INSPECTION]);
    expect(local.inspections.get(record.id)).toMatchObject({ deleting: true });
  });

  it("DELETE recusado (412): sai da fila, o 'Excluindo' é desfeito e a vistoria continua", async () => {
    const server = fakeServer();
    server.answers.remove = 412;
    const local = await start(server);
    const record = local.known();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await deleteInspection(local.store, record.id);
    await drained(local.outbox);

    await vi.waitFor(() => expect(local.inspections.get(record.id)?.deleting).toBeUndefined());
    expect(local.inspections.get(record.id)).toMatchObject({ id: record.id, version: "v1" });
    expect(local.confirmed.get(record.id)).toMatchObject({ version: "v1" });
  });
});
