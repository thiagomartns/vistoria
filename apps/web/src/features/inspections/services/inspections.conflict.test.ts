import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftRecord, DraftsCollection } from "@/shared/sync/drafts";
import { type Outbox, enqueue, startOutbox } from "@/shared/sync/outbox";

import type { InspectionRecord, ItemRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import {
  type ConflictChoice,
  collisionKey,
  inspectionConflictOf,
  resolveInspection,
} from "./inspections.resolve";
import {
  UPSERT_INSPECTION,
  resolveInspectionConflict,
  upsertInspectionMutation,
} from "./inspections.sync";

// O version-conflict na outbox (frontend.md, "Conflito", passos 1 a 3), com o executor de verdade e a mutationFn de
// verdade da vistoria, contra um servidor falso que, como a API, confere o If-Match e responde 412 com o current.

vi.mock("@/shared/auth/session", () => ({
  canSendAs: () => true,
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

const item = (id: string, name: string, position: number): ItemRecord => ({
  id,
  name,
  position,
  condition: null,
  notes: null,
});

// A vistoria como o aparelho a confirmou por último (V1).
const confirmedV1: InspectionRecord = {
  id: "01a16032-2dfb-77de-84a2-1f165bdd9940",
  version: "AAAAAAAAAAE=",
  propertyId: "01a16032-2dfb-77de-84a2-1f165bdd993f",
  kind: "moveIn",
  status: "inProgress",
  startedAt: "2026-10-26T13:00:00.000Z",
  generalNotes: null,
  rooms: [
    {
      id: "r1",
      name: "Sala",
      position: 0,
      notes: null,
      items: [item("t1", "Piso", 0), item("t2", "Parede", 1)],
    },
  ],
};

/** Uma cópia com a mudança de um lado. */
function edited(change: (draft: InspectionRecord) => void, from: InspectionRecord = confirmedV1) {
  const draft = structuredClone(from);
  change(draft);
  return draft;
}
const itemOf = (record: InspectionRecord, id: string) =>
  record.rooms.flatMap((room) => room.items).find((entry) => entry.id === id) as ItemRecord;

/** O DTO que a API devolve: com as datas, `completedAt` e os campos de referência. */
const dtoOf = (record: InspectionRecord) => ({
  ...record,
  referenceInspectionId: null,
  completedAt: null,
  startedAt: "2026-10-26T13:00:00.0000000+00:00",
  rooms: record.rooms.map((room) => ({
    ...room,
    items: room.items.map((entry) => ({
      ...entry,
      referenceCondition: null,
      referenceNotes: null,
    })),
  })),
  createdAt: "2026-10-26T13:00:01+00:00",
  updatedAt: "2026-10-27T09:00:00+00:00",
});

/**
 * O servidor falso: guarda a vistoria (`server`), confere o If-Match contra a versão dela e responde 412 com o
 * current quando difere; senão grava o corpo numa versão nova. `offlineFirst` derruba as primeiras requisições sem
 * resposta. Anota cada `PUT`.
 */
function fakeServer(initial: InspectionRecord, { offlineFirst = 0 } = {}) {
  let server = initial;
  let versions = 2;
  let offline = offlineFirst;
  const sent: { key: string | null; ifMatch: string | null; body: Record<string, unknown> }[] = [];
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      const request = input as Request;
      const body = (await request.json()) as Record<string, unknown>;
      sent.push({
        key: request.headers.get("Idempotency-Key"),
        ifMatch: request.headers.get("If-Match"),
        body,
      });
      if (offline > 0) {
        offline -= 1;
        throw new TypeError("Failed to fetch");
      }
      if (request.headers.get("If-Match") !== `"${server.version}"`) {
        return Response.json(
          {
            type: "urn:vistoria:problem:version-conflict",
            title: "version-conflict",
            status: 412,
            detail: "version-conflict",
            traceId: "00-trace",
            current: dtoOf(server),
          },
          { status: 412, headers: { "content-type": "application/problem+json" } },
        );
      }
      versions += 1;
      server = {
        ...(body as Omit<InspectionRecord, "id" | "version">),
        id: server.id,
        version: `V${versions}`,
      };
      return Response.json(dtoOf(server), { status: 200 });
    },
  });
  return { client, sent, current: () => server };
}

/** O que o servidor confirmou (a store IndexedDB, no app), já com a V1, e os rascunhos, em memória. */
function localStores() {
  const confirmed = new Map<string, InspectionRecord>([[confirmedV1.id, confirmedV1]]);
  const drafts = new Map<string, Record<string, unknown>>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: { id: string }) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: Record<string, unknown>) => void) =>
      change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  return { confirmed, drafts, draftsCollection };
}

let open: Outbox[] = [];

afterEach(() => {
  for (const outbox of open) outbox.dispose();
  open = [];
  localStorage.clear();
  vi.restoreAllMocks();
});

/** A collection da vistoria: a camada otimista do TanStack DB por cima da store confirmada em memória. */
async function start(server: ReturnType<typeof fakeServer>, local: ReturnType<typeof localStores>) {
  const optimistic = createCollection(
    localOnlyCollectionOptions<InspectionRecord, string>({
      id: "inspections",
      getKey: (row) => row.id,
    }),
  );
  const inspections = {
    get: (id: string) => optimistic.get(id),
    has: (id: string) => optimistic.has(id),
    insert: (row: InspectionRecord) => optimistic.insert(row),
    update: (id: string, change: (row: InspectionRecord) => void) => optimistic.update(id, change),
    utils: {
      exportData: async () => [...local.confirmed.values()],
      readConfirmed: async (ids: readonly string[]) => ids.flatMap((key) => local.confirmed.get(key) ?? []),
      acceptMutations: async ({ mutations }: { mutations: { modified: InspectionRecord }[] }) => {
        for (const { modified } of mutations) local.confirmed.set(modified.id, modified);
      },
    },
  } as unknown as InspectionsCollection;
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { inspections: optimistic },
    mutationFns: {
      [UPSERT_INSPECTION]: upsertInspectionMutation(
        inspections,
        local.draftsCollection,
        server.client,
      ),
    },
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  return { outbox, optimistic, inspections };
}

/** Uma edição da vistoria na fila, como `saveInspection`: aplica na camada otimista e enfileira o `PUT`. */
function save(
  outbox: Outbox,
  optimistic: Awaited<ReturnType<typeof start>>["optimistic"],
  record: InspectionRecord,
) {
  enqueue(outbox, UPSERT_INSPECTION, () => {
    if (optimistic.has(record.id)) {
      optimistic.update(record.id, (draft) => {
        Object.assign(draft, record);
      });
    } else {
      optimistic.insert(record);
    }
  });
}

/** Espera a fila esvaziar depois de o servidor receber o primeiro `PUT`. */
const drained = (outbox: Outbox, server: ReturnType<typeof fakeServer>) =>
  vi.waitFor(
    async () => {
      expect(server.sent.length).toBeGreaterThan(0);
      expect(await outbox.peekOutbox()).toHaveLength(0);
    },
    { timeout: 5_000 },
  );

describe("version-conflict na outbox", () => {
  it("itens diferentes: o merge reenvia uma vez, com If-Match do current e chave nova, e termina sincronizado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = fakeServer(
      edited((v) => {
        itemOf(v, "t2").condition = "poor";
        v.version = "V2";
      }),
    );
    const local = localStores();
    const { outbox, optimistic } = await start(server, local);

    save(
      outbox,
      optimistic,
      edited((v) => (itemOf(v, "t1").condition = "good")),
    );
    await drained(outbox, server);

    expect(server.sent).toHaveLength(2);
    const [first, resent] = server.sent;
    expect(first?.ifMatch).toBe(`"${confirmedV1.version}"`);
    expect(resent?.ifMatch).toBe('"V2"');
    expect(resent?.key).not.toBe(first?.key);
    const merged = edited((v) => {
      itemOf(v, "t1").condition = "good";
      itemOf(v, "t2").condition = "poor";
      v.version = "V3";
    });
    expect(server.current()).toEqual(merged);
    expect(local.confirmed.get(confirmedV1.id)).toEqual(merged);
    expect(local.drafts.size).toBe(0);
  });

  it("o mesmo item com condições diferentes: não reenvia, não entra em laço, e o rascunho fica em conflito", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = fakeServer(
      edited((v) => {
        itemOf(v, "t1").condition = "poor";
        v.version = "V2";
      }),
    );
    const local = localStores();
    const { outbox, optimistic } = await start(server, local);

    const mine = edited((v) => (itemOf(v, "t1").condition = "good"));
    save(outbox, optimistic, mine);
    await drained(outbox, server);
    outbox.getOnlineDetector().notifyOnline();
    await new Promise((done) => setTimeout(done, 300));

    expect(server.sent).toHaveLength(1);
    expect(local.confirmed.get(confirmedV1.id)).toEqual(confirmedV1);
    expect(local.drafts.get(confirmedV1.id)).toMatchObject({
      entity: "inspection",
      status: "conflict",
      data: mine,
      conflict: {
        base: confirmedV1,
        collisions: [
          {
            kind: "field",
            roomId: "r1",
            itemId: "t1",
            field: "condition",
            base: null,
            local: "good",
            server: "poor",
          },
        ],
      },
    });
  });

  it("a escrita própria cuja resposta se perdeu: sucesso com a version do current, sem reenvio", async () => {
    const mine = edited((v) => (itemOf(v, "t1").condition = "good"));
    const server = fakeServer({ ...mine, version: "V2" });
    const local = localStores();
    const { outbox, optimistic } = await start(server, local);

    save(outbox, optimistic, mine);
    await drained(outbox, server);

    expect(server.sent).toHaveLength(1);
    expect(local.confirmed.get(confirmedV1.id)).toEqual({ ...mine, version: "V2" });
    expect(local.drafts.size).toBe(0);
  });

  it("a edição que estava atrás na fila entra no merge e é compactada: não sai por cima do servidor", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // A primeira tentativa fica sem resposta: a transação A já foi tentada quando a B entra na fila atrás dela.
    const server = fakeServer(
      edited((v) => {
        itemOf(v, "t2").condition = "poor";
        v.version = "V2";
      }),
      { offlineFirst: 1 },
    );
    const local = localStores();
    const { outbox, optimistic } = await start(server, local);

    const a = edited((v) => (itemOf(v, "t1").condition = "good"));
    save(outbox, optimistic, a);
    await vi.waitFor(() => expect(server.sent).toHaveLength(1), { timeout: 5_000 });
    const b = edited((v) => (itemOf(v, "t1").notes = "Risco perto da porta."), a);
    save(outbox, optimistic, b);
    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(2));
    outbox.getOnlineDetector().notifyOnline();
    await drained(outbox, server);

    // A sem resposta, A com 412, e o merge. A B nunca sai sozinha.
    expect(server.sent).toHaveLength(3);
    expect(server.sent[0]?.key).toBe(server.sent[1]?.key);
    expect(server.sent[2]?.ifMatch).toBe('"V2"');
    expect(new Set(server.sent.map(({ key }) => key)).size).toBe(2);
    expect(server.current()).toEqual(
      edited((v) => {
        itemOf(v, "t1").condition = "good";
        itemOf(v, "t1").notes = "Risco perto da porta.";
        itemOf(v, "t2").condition = "poor";
        v.version = "V3";
      }),
    );
  });

  it("o merge igual ao servidor: só adota o current, sem um PUT a mais", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = fakeServer(
      edited((v) => {
        itemOf(v, "t1").condition = "good";
        itemOf(v, "t2").condition = "poor";
        v.version = "V2";
      }),
    );
    const local = localStores();
    const { outbox, optimistic } = await start(server, local);

    save(
      outbox,
      optimistic,
      edited((v) => (itemOf(v, "t1").condition = "good")),
    );
    await drained(outbox, server);

    expect(server.sent).toHaveLength(1);
    // A store fica com o current como o .NET o devolve (startedAt em +00:00, com 7 casas).
    expect(local.confirmed.get(confirmedV1.id)).toEqual({
      ...server.current(),
      startedAt: "2026-10-26T13:00:00.0000000+00:00",
    });
  });

  it("na tela de campo, o merge vem do rascunho (mais novo que a fila) e volta para ele", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = fakeServer(
      edited((v) => {
        itemOf(v, "t2").condition = "poor";
        v.version = "V2";
      }),
    );
    const local = localStores();
    const { outbox, optimistic } = await start(server, local);
    const queued = edited((v) => (itemOf(v, "t1").condition = "good"));
    // O rascunho tem uma observação que ainda não foi para a fila.
    const { version: _version, ...typed } = edited(
      (v) => (itemOf(v, "t1").notes = "Trincado."),
      queued,
    );
    local.drafts.set(confirmedV1.id, {
      id: confirmedV1.id,
      entity: "inspection",
      data: typed,
      status: "draft",
      step: 0,
      errors: {},
      updatedAt: "2026-10-27T09:00:00.000Z",
    });

    save(outbox, optimistic, queued);
    await drained(outbox, server);

    const { version: _merged, ...merged } = edited((v) => {
      itemOf(v, "t1").condition = "good";
      itemOf(v, "t1").notes = "Trincado.";
      itemOf(v, "t2").condition = "poor";
    });
    expect(server.current()).toEqual({ ...merged, version: "V3" });
    expect(local.drafts.get(confirmedV1.id)).toMatchObject({
      status: "draft",
      step: 0,
      data: merged,
      rebasedAt: expect.any(String),
    });
  });
});

describe("resolução no ConflictResolver", () => {
  // O outro aparelho marcou Piso e Parede de outro jeito e escreveu a observação da Sala; aqui, a pessoa marcou Piso e
  // Parede e as observações gerais. Piso e Parede colidem; as duas observações entram sozinhas.
  const theirs = edited((v) => {
    itemOf(v, "t1").condition = "poor";
    itemOf(v, "t2").condition = "fair";
    v.rooms[0]!.notes = "Rodapé solto.";
    v.version = "V2";
  });
  const mine = edited((v) => {
    itemOf(v, "t1").condition = "good";
    itemOf(v, "t2").condition = "good";
    v.generalNotes = "Duas chaves.";
  });
  const PISO = "room:r1:item:t1:condition";
  const PAREDE = "room:r1:item:t2:condition";

  /** A tela de campo marcou `local`, a fila mandou, e o 412 deixou o rascunho em conflito. */
  async function conflicted(server: InspectionRecord, local: InspectionRecord) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = fakeServer(server);
    const stores = localStores();
    const started = await start(api, stores);
    const { version: _version, ...typed } = local;
    stores.drafts.set(confirmedV1.id, {
      id: confirmedV1.id,
      entity: "inspection",
      data: typed,
      status: "draft",
      step: 0,
      errors: {},
      updatedAt: "2026-10-27T09:00:00.000Z",
    });
    save(started.outbox, started.optimistic, local);
    await drained(started.outbox, api);
    const draft = stores.drafts.get(confirmedV1.id) as unknown as DraftRecord;
    expect(draft.status).toBe("conflict");
    return { api, stores, ...started, conflict: inspectionConflictOf(draft)! };
  }

  async function resolve(
    setup: Awaited<ReturnType<typeof conflicted>>,
    choices: Record<string, ConflictChoice>,
  ) {
    const { api, stores, outbox, inspections, conflict } = setup;
    const resolved = resolveInspection(conflict, choices);
    await resolveInspectionConflict(
      { inspections, drafts: stores.draftsCollection, outbox },
      { resolved, server: conflict.server },
    );
    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), {
      timeout: 5_000,
    });
    return { api, stores, resolved };
  }

  /** O que sai no PUT da resolução e fica no servidor. */
  const body = (change: (draft: InspectionRecord) => void) =>
    edited((v) => {
      v.rooms[0]!.notes = "Rodapé solto.";
      v.generalNotes = "Duas chaves.";
      change(v);
      v.version = "V3";
    });

  it("o merge refeito mostra só o que colidiu, por item", async () => {
    const { conflict } = await conflicted(theirs, mine);
    expect(conflict.collisions.map(collisionKey)).toEqual([PISO, PAREDE]);
    expect(conflict.server.version).toBe("V2");
  });

  it.each<[string, Record<string, ConflictChoice>, (draft: InspectionRecord) => void]>([
    [
      "tudo meu",
      { [PISO]: "meu", [PAREDE]: "meu" },
      (v) => {
        itemOf(v, "t1").condition = "good";
        itemOf(v, "t2").condition = "good";
      },
    ],
    [
      "tudo do servidor (com a observação geral, que só mudou aqui)",
      { [PISO]: "servidor", [PAREDE]: "servidor" },
      (v) => {
        itemOf(v, "t1").condition = "poor";
        itemOf(v, "t2").condition = "fair";
      },
    ],
    [
      "misto",
      { [PISO]: "meu", [PAREDE]: "servidor" },
      (v) => {
        itemOf(v, "t1").condition = "good";
        itemOf(v, "t2").condition = "fair";
      },
    ],
  ])(
    "%s: uma transação nova, com If-Match do current e chave nova, e termina sincronizado com o escolhido",
    async (_name, choices, chosen) => {
      const setup = await conflicted(theirs, mine);
      const { api, stores } = await resolve(setup, choices);

      expect(api.sent).toHaveLength(2);
      const [first, resolution] = api.sent;
      expect(resolution?.ifMatch).toBe('"V2"');
      expect(resolution?.key).not.toBe(first?.key);
      const expected = body(chosen);
      expect(api.current()).toEqual(expected);
      expect(stores.confirmed.get(confirmedV1.id)).toMatchObject({
        ...expected,
        startedAt: expect.any(String),
      });
      const { version: _version, ...values } = expected;
      expect(stores.drafts.get(confirmedV1.id)).toMatchObject({
        status: "draft",
        step: 0,
        data: values,
        rebasedAt: expect.any(String),
      });
      expect(stores.drafts.get(confirmedV1.id)).not.toHaveProperty("conflict");
    },
  );

  it("tudo do servidor, sem mais nada daqui: só adota o current, sem PUT", async () => {
    const setup = await conflicted(
      theirs,
      edited((v) => (itemOf(v, "t1").condition = "good")),
    );
    expect(setup.conflict.collisions.map(collisionKey)).toEqual([PISO]);
    const { api, stores } = await resolve(setup, { [PISO]: "servidor" });

    expect(api.sent).toHaveLength(1);
    expect(stores.confirmed.get(confirmedV1.id)).toEqual(setup.conflict.server);
    expect(stores.drafts.get(confirmedV1.id)).toMatchObject({ status: "draft" });
  });
});
