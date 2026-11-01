import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import { type Outbox, enqueue, startOutbox } from "@/shared/sync/outbox";

import type { PropertyRecord } from "@/features/properties/models/property";
import type { PropertiesCollection } from "@/features/properties/services/properties.collection";
import { UPSERT_PROPERTY, upsertPropertyMutation } from "@/features/properties/services/properties.sync";

import type { InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import { UPSERT_INSPECTION, upsertInspectionMutation } from "./inspections.sync";

// A vistoria na outbox única, com o executor de verdade e as mutationFns de verdade de properties e inspections,
// contra um servidor falso que, como a API, recusa a vistoria de um imóvel que ele não conhece (ADR 0034).

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

const property: PropertyRecord = {
  id: "01a16032-2dfb-77de-84a2-1f165bdd993f",
  version: null,
  clientId: "01a16032-2dfb-77de-84a2-1f165bdd993e",
  street: "Rua das Flores",
  number: "120",
  complement: "ap 32",
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: null,
};

const validation = (errors: Record<string, string[]>) =>
  Response.json(
    {
      type: "urn:vistoria:problem:validation",
      title: "validation",
      status: 400,
      detail: "validation",
      traceId: "00-trace",
      errors,
    },
    { status: 400, headers: { "content-type": "application/problem+json" } },
  );

/**
 * O servidor falso: grava o imóvel (ou o recusa, com `rejectProperty`) e só aceita a vistoria de um imóvel gravado.
 * Anota cada `PUT` com a entidade, o id e a chave.
 */
function fakeServer({ rejectProperty = false } = {}) {
  const sent: { entity: string; id: string; key: string | null }[] = [];
  const known = new Set<string>();
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      const request = input as Request;
      const [, , , entity, id] = new URL(request.url).pathname.split("/");
      sent.push({ entity: entity!, id: id!, key: request.headers.get("Idempotency-Key") });
      const body = await request.json();
      if (entity === "properties") {
        if (rejectProperty) return validation({ zipCode: ["Informe o CEP com 8 dígitos, sem hífen."] });
        known.add(id!);
        return Response.json({ ...body, id, version: "AAAAAAAAB9M=" }, { status: 201 });
      }
      if (!known.has(body.propertyId)) return validation({ propertyId: ["Imóvel não encontrado."] });
      return Response.json({ ...body, id, version: "AAAAAAAAB9Q=" }, { status: 201 });
    },
  });
  return { client, sent };
}

/** O que o servidor confirmou (a store IndexedDB, no app) e os rascunhos, em memória. */
function localStores() {
  const confirmed = new Map<string, { id: string; version: string | null }>();
  const store = {
    utils: {
      exportData: async () => [...confirmed.values()],
      readConfirmed: async (ids: readonly string[]) => ids.flatMap((key) => confirmed.get(key) ?? []),
      acceptMutations: async ({ mutations }: { mutations: { modified: { id: string; version: string } }[] }) => {
        for (const { modified } of mutations) confirmed.set(modified.id, modified);
      },
    },
  };
  const drafts = new Map<string, Record<string, unknown>>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: { id: string }) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: Record<string, unknown>) => void) => change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  return { confirmed, store, drafts, draftsCollection };
}

let open: Outbox[] = [];

afterEach(() => {
  for (const outbox of open) outbox.dispose();
  open = [];
  canSend = true;
  localStorage.clear();
  vi.restoreAllMocks();
});

async function start(server: ReturnType<typeof fakeServer>, local: ReturnType<typeof localStores>) {
  const properties = createCollection(
    localOnlyCollectionOptions<PropertyRecord, string>({ id: "properties", getKey: (row) => row.id }),
  );
  const inspections = createCollection(
    localOnlyCollectionOptions<InspectionRecord, string>({ id: "inspections", getKey: (row) => row.id }),
  );
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { properties, inspections },
    mutationFns: {
      [UPSERT_PROPERTY]: upsertPropertyMutation(
        local.store as unknown as PropertiesCollection,
        local.draftsCollection,
        server.client,
      ),
      [UPSERT_INSPECTION]: upsertInspectionMutation(
        local.store as unknown as InspectionsCollection,
        local.draftsCollection,
        server.client,
      ),
    },
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  return { outbox, properties, inspections };
}

const reconnect = (outbox: Outbox) => {
  canSend = true;
  outbox.getOnlineDetector().notifyOnline();
};

describe("vistoria na outbox", () => {
  it("imóvel e vistoria criados offline: o imóvel sai antes, e a vistoria é aceita", async () => {
    canSend = false;
    const server = fakeServer();
    const local = localStores();
    const { outbox, properties, inspections } = await start(server, local);
    const inspection = newMoveInInspection(property.id);

    enqueue(outbox, UPSERT_PROPERTY, () => properties.insert(property));
    enqueue(outbox, UPSERT_INSPECTION, () => inspections.insert(inspection));
    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(2));
    reconnect(outbox);

    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 });
    expect(server.sent.map(({ entity, id }) => [entity, id])).toEqual([
      ["properties", property.id],
      ["inspections", inspection.id],
    ]);
    expect(local.confirmed.get(inspection.id)).toEqual({ ...inspection, version: "AAAAAAAAB9Q=" });
    expect(local.drafts.size).toBe(0);
  });

  it("imóvel recusado: a vistoria volta com erro em propertyId e vira rascunho, sem laço", async () => {
    canSend = false;
    const server = fakeServer({ rejectProperty: true });
    const local = localStores();
    const { outbox, properties, inspections } = await start(server, local);
    const inspection = newMoveInInspection(property.id);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    enqueue(outbox, UPSERT_PROPERTY, () => properties.insert(property));
    enqueue(outbox, UPSERT_INSPECTION, () => inspections.insert(inspection));
    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(2));
    reconnect(outbox);

    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 });
    expect(local.drafts.get(inspection.id)).toMatchObject({
      entity: "inspection",
      status: "rejected",
      data: inspection,
      errors: { propertyId: ["Imóvel não encontrado."] },
    });
    expect(local.drafts.get(property.id)).toMatchObject({ entity: "property", status: "rejected" });
    // Acordar a fila não reenvia o que saiu dela.
    outbox.getOnlineDetector().notifyOnline();
    await new Promise((done) => setTimeout(done, 300));
    expect(server.sent.map(({ entity }) => entity)).toEqual(["properties", "inspections"]);
    expect(local.confirmed.size).toBe(0);
  });

  it("recarregar com a vistoria na fila: ela continua lá e sai uma vez só quando a rede volta", async () => {
    canSend = false;
    const server = fakeServer();
    const local = localStores();
    // O imóvel já está no servidor: só a vistoria fica na fila.
    const known = await start(server, local);
    enqueue(known.outbox, UPSERT_PROPERTY, () => known.properties.insert(property));
    reconnect(known.outbox);
    await vi.waitFor(async () => expect(await known.outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 });

    canSend = false;
    const inspection = newMoveInInspection(property.id);
    enqueue(known.outbox, UPSERT_INSPECTION, () => known.inspections.insert(inspection));
    await vi.waitFor(async () => expect(await known.outbox.peekOutbox()).toHaveLength(1));
    known.outbox.dispose();
    open = [];
    // A página antiga solta o lock de líder antes de a nova pedir.
    await new Promise((done) => setTimeout(done, 0));

    // Recarregar: uma outbox nova sobre o mesmo armazenamento, ainda sem rede.
    const reloaded = await start(server, local);
    const [pending] = await reloaded.outbox.peekOutbox();
    expect(pending?.mutations[0]?.modified).toEqual(inspection);
    // O otimista volta da outbox (a linha da collection leva também as props virtuais, `$synced` e afins).
    expect(reloaded.inspections.get(inspection.id)).toMatchObject(inspection);
    reconnect(reloaded.outbox);

    await vi.waitFor(async () => expect(await reloaded.outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 });
    await new Promise((done) => setTimeout(done, 300));
    const inspectionPuts = server.sent.filter(({ entity }) => entity === "inspections");
    expect(inspectionPuts).toEqual([{ entity: "inspections", id: inspection.id, key: pending?.idempotencyKey }]);
    expect(local.confirmed.get(inspection.id)).toEqual({ ...inspection, version: "AAAAAAAAB9Q=" });
  });
});
