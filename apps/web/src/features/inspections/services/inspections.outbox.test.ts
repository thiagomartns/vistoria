import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import { type SyncNotice, subscribeNotices } from "@/shared/sync/notices";
import { type Outbox, enqueue, startOutbox } from "@/shared/sync/outbox";

import type { PropertyRecord } from "@/features/properties/models/property";
import type { PropertiesCollection } from "@/features/properties/services/properties.collection";
import { UPSERT_PROPERTY, upsertPropertyMutation } from "@/features/properties/services/properties.sync";

import type { InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import {
  LOCKED_DESCRIPTION,
  LOCKED_TITLE,
  UPSERT_INSPECTION,
  completeInspection,
  upsertInspectionMutation,
} from "./inspections.sync";

// A vistoria na outbox única, com o executor de verdade e as mutationFns de verdade de properties e inspections,
// contra um servidor falso que, como a API, recusa a vistoria de um imóvel que ele não conhece (ADR 0034). A conclusão
// (#179) passa pelo mesmo `PUT`: o servidor falso grava o `completedAt` e o `completedBy` (#183), recusa item sem
// condição ou responde `locked`.

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

const COMPLETED_AT = "2026-10-19T14:32:00+00:00";
const COMPLETED_BY = { id: "01a16032-2dfc-7334-9752-3da4fdcc2e88", name: "Thiago Martins" };

/** A resposta 409 `locked`, com o `current` da vistoria concluída em outro aparelho. */
const locked = (current: Record<string, unknown>) =>
  Response.json(
    {
      type: "urn:vistoria:problem:locked",
      title: "Vistoria concluída",
      status: 409,
      detail: "A vistoria já foi concluída e não aceita mais alterações.",
      traceId: "00-trace",
      current,
    },
    { status: 409, headers: { "content-type": "application/problem+json" } },
  );

/**
 * O servidor falso: grava o imóvel (ou o recusa, com `rejectProperty`) e só aceita a vistoria de um imóvel gravado.
 * Como a API, a conclusão exige condição em todos os itens e ganha o `completedAt` e o
 * `completedBy`; com `lockedBy`, toda vistoria já
 * está concluída por outro aparelho (409 `locked` com esse `current`). Anota cada `PUT` com a entidade, o id, a chave e
 * o corpo.
 */
function fakeServer({
  rejectProperty = false,
  lockedBy,
}: { rejectProperty?: boolean; lockedBy?: Record<string, unknown> } = {}) {
  const sent: { entity: string; id: string; key: string | null; body?: Record<string, unknown> }[] = [];
  const known = new Set<string>();
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      const request = input as Request;
      const [, , , entity, id] = new URL(request.url).pathname.split("/");
      const body = await request.json();
      sent.push({ entity: entity!, id: id!, key: request.headers.get("Idempotency-Key"), body });
      if (entity === "properties") {
        if (rejectProperty) return validation({ zipCode: ["Informe o CEP com 8 dígitos, sem hífen."] });
        known.add(id!);
        return Response.json({ ...body, id, version: "AAAAAAAAB9M=" }, { status: 201 });
      }
      if (!known.has(body.propertyId)) return validation({ propertyId: ["Imóvel não encontrado."] });
      if (lockedBy) return locked(lockedBy);
      if (body.status === "completed") {
        const errors: Record<string, string[]> = {};
        (body.rooms as InspectionRecord["rooms"]).forEach((room, r) =>
          room.items.forEach((each, i) => {
            if (each.condition === null) {
              errors[`rooms[${r}].items[${i}].condition`] = ["Para concluir, avalie a condição do item."];
            }
          }),
        );
        if (Object.keys(errors).length > 0) return validation(errors);
        return Response.json({
          ...body,
          id,
          version: "AAAAAAAAB9R=",
          completedAt: COMPLETED_AT,
          completedBy: COMPLETED_BY,
        });
      }
      return Response.json(
        { ...body, id, version: "AAAAAAAAB9Q=", completedAt: null, completedBy: null },
        { status: 201 },
      );
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
    const inspectionPuts = server.sent
      .filter(({ entity }) => entity === "inspections")
      .map(({ entity, id, key }) => ({ entity, id, key }));
    expect(inspectionPuts).toEqual([{ entity: "inspections", id: inspection.id, key: pending?.idempotencyKey }]);
    expect(local.confirmed.get(inspection.id)).toEqual({ ...inspection, version: "AAAAAAAAB9Q=" });
  });
});

describe("concluir pela outbox (#179)", () => {
  /** O imóvel e a vistoria já no servidor; a vistoria com tudo avaliado, menos o que `pending` deixar sem condição. */
  async function synced(server: ReturnType<typeof fakeServer>, local: ReturnType<typeof localStores>) {
    const started = await start(server, local);
    const inspection = newMoveInInspection(property.id);
    enqueue(started.outbox, UPSERT_PROPERTY, () => started.properties.insert(property));
    enqueue(started.outbox, UPSERT_INSPECTION, () => started.inspections.insert(inspection));
    await vi.waitFor(() => expect(local.confirmed.has(inspection.id)).toBe(true), { timeout: 5_000 });
    await vi.waitFor(async () => expect(await started.outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 });
    return { ...started, inspection: { ...inspection, version: "AAAAAAAAB9Q=" } };
  }

  const evaluated = (inspection: InspectionRecord): Omit<InspectionRecord, "version"> => {
    const { version: _version, ...values } = inspection;
    return {
      ...values,
      rooms: values.rooms.map((room) => ({
        ...room,
        items: room.items.map((each) => ({ ...each, condition: "good" as const })),
      })),
    };
  };

  function draftOfScreen(local: ReturnType<typeof localStores>, values: Omit<InspectionRecord, "version">) {
    local.drafts.set(values.id, {
      id: values.id,
      entity: "inspection",
      data: values,
      status: "draft",
      step: 4,
      errors: {},
      updatedAt: "2026-10-19T14:30:00.000Z",
    });
  }

  it("offline: o PUT com status completed fica na fila; com a rede, sai uma vez só e a store fica concluída com o completedAt e o completedBy", async () => {
    const server = fakeServer();
    const local = localStores();
    const { outbox, inspections, inspection } = await synced(server, local);
    const values = evaluated(inspection);
    draftOfScreen(local, values);

    canSend = false;
    completeInspection(
      { inspections: inspections as unknown as InspectionsCollection, drafts: local.draftsCollection, outbox },
      values,
    );

    // Na hora, concluída na camada otimista, e o rascunho saiu.
    expect(inspections.get(inspection.id)?.status).toBe("completed");
    expect(local.drafts.has(inspection.id)).toBe(false);
    const [queued] = await vi.waitFor(async () => {
      const entries = await outbox.peekOutbox();
      expect(entries).toHaveLength(1);
      return entries;
    });
    expect(queued?.mutations[0]?.modified).toMatchObject({ status: "completed" });
    reconnect(outbox);

    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 });
    await new Promise((done) => setTimeout(done, 300));
    const completions = server.sent.filter(({ body }) => body?.status === "completed");
    expect(completions).toHaveLength(1);
    expect(completions[0]?.key).toBe(queued?.idempotencyKey);
    expect(completions[0]?.body).not.toHaveProperty("completedAt");
    expect(completions[0]?.body).not.toHaveProperty("completedBy");
    expect(local.confirmed.get(inspection.id)).toEqual({
      ...values,
      status: "completed",
      version: "AAAAAAAAB9R=",
      completedAt: COMPLETED_AT,
      completedBy: COMPLETED_BY,
    });
    expect(local.drafts.has(inspection.id)).toBe(false);
  });

  it("400 da conclusão: volta ao rascunho em andamento, com o erro no caminho do item", async () => {
    const server = fakeServer();
    const local = localStores();
    const { outbox, inspections, inspection } = await synced(server, local);
    const values = evaluated(inspection);
    values.rooms[0]!.items[1]!.condition = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    completeInspection(
      { inspections: inspections as unknown as InspectionsCollection, drafts: local.draftsCollection, outbox },
      values,
    );

    await vi.waitFor(() => expect(local.drafts.get(inspection.id)?.status).toBe("rejected"), {
      timeout: 5_000,
    });
    expect(local.drafts.get(inspection.id)).toMatchObject({
      entity: "inspection",
      data: { ...values, status: "inProgress" },
      errors: { "rooms[0].items[1].condition": ["Para concluir, avalie a condição do item."] },
    });
    // A store confirmada segue com a vistoria em andamento: a recusa desfaz a conclusão otimista.
    expect(local.confirmed.get(inspection.id)).toEqual(inspection);
  });

  it("409 locked: adota o current, tira o rascunho e avisa uma vez que foi concluída em outro aparelho", async () => {
    const local = localStores();
    const notices: SyncNotice[] = [];
    const stop = subscribeNotices((notice) => notices.push(notice));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // O imóvel e a vistoria chegam ao servidor; depois, outro aparelho a conclui.
    const first = fakeServer();
    const { outbox, inspection } = await synced(first, local);
    outbox.dispose();
    open = [];
    await new Promise((done) => setTimeout(done, 0));
    const current = {
      ...evaluated(inspection),
      id: inspection.id,
      status: "completed",
      version: "AAAAAAAAB9S=",
      completedAt: COMPLETED_AT,
      completedBy: COMPLETED_BY,
      createdAt: "2026-10-19T09:12:00+00:00",
      updatedAt: COMPLETED_AT,
      referenceInspectionId: null,
    };
    const server = fakeServer({ lockedBy: current });
    const again = await start(server, local);
    enqueue(again.outbox, UPSERT_PROPERTY, () => again.properties.insert(property));
    await vi.waitFor(() => expect(server.sent).toHaveLength(1), { timeout: 5_000 });

    // Aqui, a pessoa ainda edita a vistoria em andamento.
    const edited = structuredClone(inspection);
    edited.rooms[0]!.items[0]!.condition = "poor";
    draftOfScreen(local, edited);
    enqueue(again.outbox, UPSERT_INSPECTION, () => again.inspections.insert(edited));

    await vi.waitFor(() => expect(local.drafts.has(inspection.id)).toBe(false), { timeout: 5_000 });
    expect(local.confirmed.get(inspection.id)).toEqual({
      ...evaluated(inspection),
      status: "completed",
      version: "AAAAAAAAB9S=",
      completedAt: COMPLETED_AT,
      completedBy: COMPLETED_BY,
    });
    expect(local.drafts.has(inspection.id)).toBe(false);
    await new Promise((done) => setTimeout(done, 300));
    expect(notices).toEqual([
      {
        id: `locked:${inspection.id}`,
        tone: "warning",
        title: LOCKED_TITLE,
        description: LOCKED_DESCRIPTION,
      },
    ]);
    stop();
  });
});
