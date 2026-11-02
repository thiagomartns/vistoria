import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import { type Outbox, startOutbox } from "@/shared/sync/outbox";

import type { InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import {
  DELETE_INSPECTION,
  UPSERT_INSPECTION,
  deleteInspection,
  deleteInspectionMutation,
  discardDeletedInspection,
  keepInspection,
  recreateInspection,
  saveInspection,
  upsertInspectionMutation,
} from "./inspections.sync";

// Os conflitos da exclusão (frontend.md, "Conflito", passos 4 e 5; ADR 0040), com o executor de verdade e as
// mutationFns de verdade, contra um servidor falso que anota cada requisição: o `PUT` numa vistoria excluída em outro
// aparelho (410) e o `DELETE` numa vistoria alterada depois que a pessoa a abriu (412).

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

type PutAnswer = "ok" | "deleted";

const DELETED_AT = "2026-10-28T14:58:00Z";

/**
 * O servidor falso. Cada `PUT` responde pelo `put` da vez (200 com a versão "v2" ou 410 `deleted`) e cada `DELETE`,
 * pelo `remove` (204 ou 412 com o `current` alterado em outro aparelho, na versão "v9"). Anota o método, o id, a
 * chave, o If-Match e o corpo de cada requisição.
 */
function fakeServer() {
  const sent: {
    method: string;
    id: string;
    key: string | null;
    ifMatch: string | null;
    body?: InspectionRecord;
  }[] = [];
  const answers = { put: "ok" as PutAnswer, remove: 204 as 204 | 412 };
  /** O que o outro aparelho gravou: a vistoria na versão "v9", com a observação geral dele. */
  const changed = (record: InspectionRecord) => ({
    ...record,
    version: "v9",
    generalNotes: "Alterada no notebook",
  });
  const known = new Map<string, InspectionRecord>();
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      const request = input as Request;
      const id = new URL(request.url).pathname.split("/")[4]!;
      const body = request.method === "PUT" ? await request.json() : undefined;
      sent.push({
        method: request.method,
        id,
        key: request.headers.get("Idempotency-Key"),
        ifMatch: request.headers.get("If-Match"),
        body,
      });
      if (request.method === "DELETE") {
        return answers.remove === 204
          ? new Response(null, { status: 204 })
          : problem("version-conflict", 412, { current: changed(known.get(id)!) });
      }
      if (answers.put === "deleted") return problem("deleted", 410, { deletedAt: DELETED_AT });
      return Response.json({ ...body, id, version: "v2" }, { status: 201 });
    },
  });
  return { client, sent, answers, known };
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
    readConfirmed: async (ids: readonly string[]) => ids.flatMap((key) => confirmed.get(key) ?? []),
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
    server.known.set(record.id, record);
    return record;
  };
  /** Marca a condição do primeiro item e põe a vistoria na fila. Devolve os valores enviados. */
  const edit = (record: InspectionRecord, condition: "good" | "fair") => {
    const { version: _version, ...values } = record;
    const [room, ...rooms] = values.rooms;
    const [item, ...items] = room!.items;
    const edited = {
      ...values,
      rooms: [{ ...room!, items: [{ ...item!, condition }, ...items] }, ...rooms],
    };
    saveInspection(store, edited);
    return edited;
  };
  return { ...local, outbox, store, known, edit };
}

const reconnect = (outbox: Outbox) => {
  canSend = true;
  outbox.getOnlineDetector().notifyOnline();
};

const drained = (outbox: Outbox) =>
  vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), { timeout: 10_000 });

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const idsOf = (record: InspectionRecord) => [
  record.id,
  ...record.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]),
];

/** O agregado sem os ids, para comparar os dados da recriada com os da excluída. */
const withoutIds = (record: InspectionRecord) =>
  record.rooms.map((room) => ({
    name: room.name,
    position: room.position,
    items: room.items.map(({ id: _id, ...item }) => item),
  }));

describe("PUT numa vistoria excluída em outro aparelho (410)", () => {
  /** Uma vistoria conhecida, editada aqui e excluída no servidor: o `PUT` volta 410. */
  async function deletedElsewhere() {
    const server = fakeServer();
    server.answers.put = "deleted";
    const local = await start(server);
    const record = local.known();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const edited = local.edit(record, "good");
    await drained(local.outbox);
    await vi.waitFor(() => expect(local.drafts.get(record.id)?.status).toBe("conflict"));
    return { server, local, record, edited };
  }

  it("sai da fila, e o rascunho fica em conflito 'deleted' com o local, a base e o deletedAt", async () => {
    const { server, local, record } = await deletedElsewhere();

    expect(server.sent.map(({ method }) => method)).toEqual(["PUT"]);
    expect(local.drafts.get(record.id)).toMatchObject({
      entity: "inspection",
      status: "conflict",
      data: { id: record.id },
      conflict: { type: "deleted", deletedAt: DELETED_AT, base: { id: record.id, version: "v1" } },
    });
    const data = local.drafts.get(record.id)!.data as InspectionRecord;
    expect(data.rooms[0]!.items[0]!.condition).toBe("good");
  });

  it("recriar: PUT sem If-Match para um id novo, com os mesmos dados e ids novos em todo ambiente e item", async () => {
    const { server, local, record, edited } = await deletedElsewhere();
    local.drafts.get(record.id)!.step = 1;
    server.answers.put = "ok";

    const created = await recreateInspection(local.store, record.id);
    await drained(local.outbox);

    const recreation = server.sent[1]!;
    expect(recreation).toMatchObject({ method: "PUT", id: created, ifMatch: null });
    const body = recreation.body!;
    const fresh = idsOf({ ...body, id: created, version: null });
    expect(fresh.some((id) => idsOf(record).includes(id))).toBe(false);
    expect(new Set(fresh).size).toBe(fresh.length);
    expect(withoutIds({ ...body, id: created, version: null })).toEqual(
      withoutIds({ ...edited, version: null }),
    );
    expect(local.confirmed.get(created)).toMatchObject({ id: created, version: "v2" });
    expect(local.confirmed.has(record.id)).toBe(false);
    expect(local.inspections.has(record.id)).toBe(false);
    expect(local.drafts.has(record.id)).toBe(false);
    expect(local.drafts.get(created)).toMatchObject({
      status: "draft",
      step: 1,
      data: { id: created },
    });
  });

  it("descartar: a vistoria e o rascunho saem do aparelho, sem requisição", async () => {
    const { server, local, record } = await deletedElsewhere();

    await discardDeletedInspection(local.store, record.id);

    expect(local.confirmed.has(record.id)).toBe(false);
    expect(local.inspections.has(record.id)).toBe(false);
    expect(local.drafts.has(record.id)).toBe(false);
    expect(await local.outbox.peekOutbox()).toEqual([]);
    expect(server.sent).toHaveLength(1);
  });

  it("um PUT que ainda estava na fila de uma vistoria descartada volta 410 e não ressuscita o conflito", async () => {
    canSend = false;
    const server = fakeServer();
    server.answers.put = "deleted";
    const local = await start(server);
    const record = local.known();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    local.edit(record, "good");

    await discardDeletedInspection(local.store, record.id);
    reconnect(local.outbox);
    await drained(local.outbox);
    await new Promise((done) => setTimeout(done, 300));

    expect(server.sent.map(({ method }) => method)).toEqual(["PUT"]);
    expect(local.drafts.has(record.id)).toBe(false);
    expect(local.inspections.has(record.id)).toBe(false);
  });
});

describe("DELETE numa vistoria alterada em outro aparelho (412)", () => {
  /** Uma vistoria conhecida, alterada no servidor e excluída aqui: o `DELETE` volta 412 com o `current`. */
  async function changedElsewhere() {
    const server = fakeServer();
    server.answers.remove = 412;
    const local = await start(server);
    const record = local.known();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await deleteInspection(local.store, record.id);
    await drained(local.outbox);
    await vi.waitFor(() => expect(local.drafts.get(record.id)?.status).toBe("conflict"));
    await vi.waitFor(() => expect(local.inspections.get(record.id)?.deleting).toBeUndefined());
    return { server, local, record };
  }

  it("o current vai para a store, o rascunho fica em conflito 'removal' e o 'Excluindo' é desfeito", async () => {
    const { local, record } = await changedElsewhere();

    expect(local.confirmed.get(record.id)).toMatchObject({
      version: "v9",
      generalNotes: "Alterada no notebook",
    });
    await vi.waitFor(() =>
      expect(local.inspections.get(record.id)).toMatchObject({
        version: "v9",
        generalNotes: "Alterada no notebook",
      }),
    );
    expect(local.inspections.get(record.id)?.deleting).toBeUndefined();
    expect(local.drafts.get(record.id)).toMatchObject({
      status: "conflict",
      data: { id: record.id, version: "v9" },
      conflict: { type: "removal", current: { version: "v9" } },
    });
  });

  it("excluir mesmo assim: o DELETE sai de novo com If-Match da versão nova e chave nova, e o 204 a tira do aparelho", async () => {
    const { server, local, record } = await changedElsewhere();
    server.answers.remove = 204;

    await deleteInspection(local.store, record.id);
    await drained(local.outbox);

    const [first, second] = server.sent;
    expect(server.sent.map(({ method }) => method)).toEqual(["DELETE", "DELETE"]);
    expect(first).toMatchObject({ ifMatch: '"v1"', key: expect.stringMatching(UUID_V7) });
    expect(second).toMatchObject({ ifMatch: '"v9"', key: expect.stringMatching(UUID_V7) });
    expect(second!.key).not.toBe(first!.key);
    expect(local.confirmed.has(record.id)).toBe(false);
    expect(local.inspections.has(record.id)).toBe(false);
    expect(local.drafts.has(record.id)).toBe(false);
  });

  it("cancelar: o conflito sai, a vistoria fica como o servidor a tem e volta a ser editável", async () => {
    const { server, local, record } = await changedElsewhere();

    keepInspection(local.store, record.id);
    local.edit(local.inspections.get(record.id)!, "fair");
    await vi.waitFor(() => expect(server.sent).toHaveLength(2), { timeout: 5_000 });
    await drained(local.outbox);

    expect(local.drafts.has(record.id)).toBe(false);
    expect(server.sent.map(({ method }) => method)).toEqual(["DELETE", "PUT"]);
    expect(server.sent[1]).toMatchObject({ ifMatch: '"v9"' });
    expect(server.sent[1]!.body).toMatchObject({ generalNotes: "Alterada no notebook" });
    expect(local.confirmed.get(record.id)).toMatchObject({ version: "v2" });
  });
});
