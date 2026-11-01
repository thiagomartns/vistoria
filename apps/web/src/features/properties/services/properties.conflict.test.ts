import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftRecord, DraftsCollection } from "@/shared/sync/drafts";
import { type ConflictChoice, flatConflictOf, resolveFlat } from "@/shared/sync/flat-conflict";
import { type Outbox, startOutbox } from "@/shared/sync/outbox";
import { conflictItems } from "@/shared/sync/sync-view";

import type { PropertyRecord } from "../models/property";
import type { PropertiesCollection } from "./properties.collection";
import {
  UPSERT_PROPERTY,
  resolvePropertyConflict,
  saveProperty,
  upsertPropertyMutation,
} from "./properties.sync";

// O conflito de imóvel de ponta a ponta (frontend.md, "Conflito"; ADR 0038), com o executor e a mutationFn de verdade
// contra um servidor falso que, como a API, confere o If-Match e responde 412 com o current. O caminho comum tem os
// testes em clients.conflict.test.ts; aqui, o que é do imóvel: os campos do endereço, o tipo e o cliente.

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

// O imóvel como o aparelho o confirmou por último (V1).
const confirmedV1: PropertyRecord = {
  id: "01a16032-2dfb-77de-84a2-1f165bdd9960",
  version: "V1",
  clientId: "c1",
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

/**
 * O servidor falso: guarda o imóvel, responde 412 com o current quando o If-Match difere e, senão, grava o corpo numa
 * versão nova. Anota cada `PUT`.
 */
function fakeServer(initial: PropertyRecord) {
  let server = initial;
  let versions = Number(initial.version!.slice(1));
  const sent: { key: string | null; ifMatch: string | null; body: Record<string, unknown> }[] = [];
  const problem = (type: string, status: number, extra: Record<string, unknown>) =>
    Response.json(
      {
        type: `urn:vistoria:problem:${type}`,
        title: type,
        status,
        detail: type,
        traceId: "00",
        ...extra,
      },
      { status, headers: { "content-type": "application/problem+json" } },
    );
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      const request = input as Request;
      const body = (await request.json()) as Omit<PropertyRecord, "id" | "version">;
      const ifMatch = request.headers.get("If-Match");
      sent.push({ key: request.headers.get("Idempotency-Key"), ifMatch, body });
      if (ifMatch !== `"${server.version}"`) {
        return problem("version-conflict", 412, {
          current: {
            ...server,
            createdAt: "2026-10-21T00:00:00+00:00",
            updatedAt: "2026-10-27T09:00:00+00:00",
          },
        });
      }
      versions += 1;
      server = { ...body, id: server.id, version: `V${versions}` };
      return Response.json(server, { status: 200 });
    },
  });
  return { client, sent, current: () => server };
}

let open: Outbox[] = [];

afterEach(() => {
  for (const outbox of open) outbox.dispose();
  open = [];
  localStorage.clear();
  vi.restoreAllMocks();
});

/** A collection: a camada otimista do TanStack DB por cima da store confirmada (já com a V1) e os rascunhos. */
async function start(server: ReturnType<typeof fakeServer>) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const confirmed = new Map<string, PropertyRecord>([[confirmedV1.id, confirmedV1]]);
  const drafts = new Map<string, DraftRecord>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: DraftRecord) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: DraftRecord) => void) => change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  const optimistic = createCollection(
    localOnlyCollectionOptions<PropertyRecord, string>({
      id: "properties",
      getKey: (row) => row.id,
    }),
  );
  const properties = {
    get: (id: string) => optimistic.get(id) ?? confirmed.get(id),
    has: (id: string) => optimistic.has(id),
    insert: (row: PropertyRecord) => optimistic.insert(row),
    update: (id: string, change: (row: PropertyRecord) => void) => optimistic.update(id, change),
    utils: {
      exportData: async () => [...confirmed.values()],
      readConfirmed: async (ids: readonly string[]) => ids.flatMap((key) => confirmed.get(key) ?? []),
      acceptMutations: async ({ mutations }: { mutations: { modified: PropertyRecord }[] }) => {
        for (const { modified } of mutations) confirmed.set(modified.id, modified);
      },
    },
  } as unknown as PropertiesCollection;
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { properties: optimistic },
    mutationFns: {
      [UPSERT_PROPERTY]: upsertPropertyMutation(properties, draftsCollection, server.client),
    },
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  const store = { properties, drafts: draftsCollection, outbox };
  const drained = (sent: number) =>
    vi.waitFor(
      async () => {
        expect(server.sent.length).toBeGreaterThanOrEqual(sent);
        expect(await outbox.peekOutbox()).toHaveLength(0);
      },
      { timeout: 5_000 },
    );
  /** Salva o formulário, como `usePropertyForm`. */
  const save = (values: Partial<PropertyRecord>) => {
    const { id: _id, version: _version, ...rest } = { ...confirmedV1, ...values };
    saveProperty(store, { id: confirmedV1.id, ...rest });
  };
  return { store, confirmed, drafts, save, drained, outbox };
}

/** O outro aparelho gravou `change` em cima da V1 (a V2). */
const elsewhere = (change: Partial<PropertyRecord>) =>
  fakeServer({ ...confirmedV1, ...change, version: "V2" });

describe("conflito de imóvel", () => {
  it("campos diferentes: converge sem perguntar, num reenvio com If-Match do current e chave nova", async () => {
    const api = elsewhere({ notes: "Chave na portaria" });
    const { save, drained, drafts, confirmed } = await start(api);

    save({ complement: "ap 32B" });
    await drained(2);

    expect(api.sent).toHaveLength(2);
    expect(api.sent[1]?.ifMatch).toBe('"V2"');
    expect(api.sent[1]?.key).not.toBe(api.sent[0]?.key);
    expect(api.current()).toEqual({
      ...confirmedV1,
      notes: "Chave na portaria",
      complement: "ap 32B",
      version: "V3",
    });
    expect(confirmed.get(confirmedV1.id)).toEqual(api.current());
    expect(drafts.size).toBe(0);
  });

  describe("o mesmo campo dos dois lados", () => {
    /** Aqui o tipo e o número; lá o tipo e as observações. O tipo colide. */
    async function conflicted() {
      const api = elsewhere({ type: "house", notes: "Chave na portaria" });
      const started = await start(api);
      started.save({ type: "commercial", number: "121" });
      await started.drained(1);
      expect(started.drafts.get(confirmedV1.id)?.status).toBe("conflict");
      return { api, ...started };
    }

    it("não reenvia sozinho e aparece em 'Ação necessária', com a rota do resolver", async () => {
      const { api, drafts } = await conflicted();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(api.sent).toHaveLength(1);
      const conflict = flatConflictOf<PropertyRecord>(drafts.get(confirmedV1.id))!;
      expect(conflict.collisions.map((collision) => collision.field)).toEqual(["type"]);
      expect(conflictItems([...drafts.values()])).toEqual([
        expect.objectContaining({
          title: "Imóvel · Rua das Flores, 121 · ap 32",
          href: `/properties/conflict?id=${confirmedV1.id}`,
        }),
      ]);
    });

    it("salvar o formulário de novo não enfileira: fica no rascunho, que o resolver usa", async () => {
      const { api, save, drafts, outbox } = await conflicted();

      save({ type: "house", number: "121" });

      expect(await outbox.peekOutbox()).toHaveLength(0);
      expect(api.sent).toHaveLength(1);
      const draft = drafts.get(confirmedV1.id)!;
      expect(draft.status).toBe("conflict");
      expect(flatConflictOf<PropertyRecord>(draft)!.collisions).toEqual([]);
    });

    it.each<[string, ConflictChoice, PropertyRecord["type"]]>([
      ["meu", "meu", "commercial"],
      ["servidor", "servidor", "house"],
    ])(
      "'%s': a escolha chega ao servidor, com If-Match do current e chave nova, e o rascunho sai",
      async (_name, choice, type) => {
        const { api, store, drafts, confirmed, drained } = await conflicted();
        const conflict = flatConflictOf<PropertyRecord>(drafts.get(confirmedV1.id))!;

        await resolvePropertyConflict(store, {
          resolved: resolveFlat(conflict, { type: choice }),
          server: conflict.server,
        });
        await drained(2);

        expect(api.sent).toHaveLength(2);
        expect(api.sent[1]?.ifMatch).toBe('"V2"');
        expect(api.sent[1]?.key).not.toBe(api.sent[0]?.key);
        expect(api.current()).toEqual({
          ...confirmedV1,
          number: "121",
          notes: "Chave na portaria",
          type,
          version: "V3",
        });
        expect(confirmed.get(confirmedV1.id)).toEqual(api.current());
        expect(drafts.size).toBe(0);
      },
    );
  });
});
