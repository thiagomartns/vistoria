import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftRecord, DraftsCollection } from "@/shared/sync/drafts";
import { flatConflictOf, resolveFlat } from "@/shared/sync/flat-conflict";
import { type Outbox, startOutbox } from "@/shared/sync/outbox";

import type { TemplateRecord, TemplateRoom } from "../models/template";
import type { TemplatesCollection } from "./templates.collection";
import {
  UPSERT_TEMPLATE,
  resolveTemplateConflict,
  saveTemplate,
  upsertTemplateMutation,
} from "./templates.sync";
import { templateConflictGroups } from "./templates.view";

// O conflito de roteiro de ponta a ponta (frontend.md, "Conflito"; ADR 0038 e 0057), com o executor e a mutationFn de
// verdade contra um servidor falso que, como a API, confere o If-Match e responde 412 com o current. O caminho comum
// tem os testes em clients.conflict.test.ts; aqui, o que é do roteiro: `rooms` é um campo só, e escolher um lado leva
// a lista inteira, na ordem.

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

const room = (id: string, name: string, position: number, items: string[] = []): TemplateRoom => ({
  id: `01a16032-2dfb-77de-84a2-1f165bdd${id}`,
  name,
  position,
  items: items.map((item, index) => ({
    id: `01a16032-2dfb-77de-84a2-1f165b${id}${String(index).padStart(2, "0")}`,
    name: item,
    position: index,
  })),
});

// O roteiro como o aparelho o confirmou por último (V1).
const confirmedV1: TemplateRecord = {
  id: "01a16032-2dfb-77de-84a2-1f165bdd9970",
  version: "V1",
  name: "Apartamento",
  rooms: [room("9a01", "Sala", 0, ["Piso", "Teto"]), room("9a02", "Cozinha", 1, ["Pia"])],
};

/**
 * O servidor falso: guarda o roteiro, responde 412 com o current quando o If-Match difere e, senão, grava o corpo numa
 * versão nova. Anota cada `PUT`.
 */
function fakeServer(initial: TemplateRecord) {
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
      const body = (await request.json()) as Omit<TemplateRecord, "id" | "version">;
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
  const confirmed = new Map<string, TemplateRecord>([[confirmedV1.id, confirmedV1]]);
  const drafts = new Map<string, DraftRecord>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: DraftRecord) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: DraftRecord) => void) => change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  const optimistic = createCollection(
    localOnlyCollectionOptions<TemplateRecord, string>({
      id: "templates",
      getKey: (row) => row.id,
    }),
  );
  const templates = {
    get: (id: string) => optimistic.get(id) ?? confirmed.get(id),
    has: (id: string) => optimistic.has(id),
    insert: (row: TemplateRecord) => optimistic.insert(row),
    update: (id: string, change: (row: TemplateRecord) => void) => optimistic.update(id, change),
    utils: {
      exportData: async () => [...confirmed.values()],
      readConfirmed: async (ids: readonly string[]) =>
        ids.flatMap((key) => confirmed.get(key) ?? []),
      acceptMutations: async ({ mutations }: { mutations: { modified: TemplateRecord }[] }) => {
        for (const { modified } of mutations) confirmed.set(modified.id, modified);
      },
    },
  } as unknown as TemplatesCollection;
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { templates: optimistic },
    mutationFns: {
      [UPSERT_TEMPLATE]: upsertTemplateMutation(templates, draftsCollection, server.client),
    },
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  const store = { templates, drafts: draftsCollection, outbox };
  const drained = (sent: number) =>
    vi.waitFor(
      async () => {
        expect(server.sent.length).toBeGreaterThanOrEqual(sent);
        expect(await outbox.peekOutbox()).toHaveLength(0);
      },
      { timeout: 5_000 },
    );
  /** Salva o editor, como `useTemplateForm`. */
  const save = (values: Partial<TemplateRecord>) => {
    const { id: _id, version: _version, ...rest } = { ...confirmedV1, ...values };
    saveTemplate(store, { id: confirmedV1.id, ...rest });
  };
  return { store, confirmed, drafts, save, drained, outbox };
}

/** O outro aparelho gravou `change` em cima da V1 (a V2). */
const elsewhere = (change: Partial<TemplateRecord>) =>
  fakeServer({ ...confirmedV1, ...change, version: "V2" });

describe("conflito de roteiro", () => {
  it("nome aqui e ambientes lá: converge sem perguntar, com os ambientes do outro aparelho", async () => {
    const theirs = [room("9a02", "Cozinha", 0, ["Pia"]), room("9a01", "Sala", 1, ["Piso", "Teto"])];
    const api = elsewhere({ rooms: theirs });
    const { save, drained, drafts } = await start(api);

    save({ name: "Apartamento padrão" });
    await drained(2);

    expect(api.sent[1]?.ifMatch).toBe('"V2"');
    expect(api.current()).toEqual({
      ...confirmedV1,
      name: "Apartamento padrão",
      rooms: theirs,
      version: "V3",
    });
    expect(drafts.size).toBe(0);
  });

  describe("os ambientes dos dois lados", () => {
    const mine = [...confirmedV1.rooms, room("9a03", "Varanda", 2)];
    const theirs = [room("9a01", "Sala ampla", 0, ["Piso"])];

    async function conflicted() {
      const api = elsewhere({ rooms: theirs });
      const started = await start(api);
      started.save({ rooms: mine });
      await started.drained(1);
      expect(started.drafts.get(confirmedV1.id)?.status).toBe("conflict");
      return { api, ...started };
    }

    it("o ConflictResolver pergunta a lista inteira, num campo Ambientes", async () => {
      const { drafts } = await conflicted();
      const conflict = flatConflictOf<TemplateRecord>(drafts.get(confirmedV1.id))!;

      expect(templateConflictGroups(conflict)[0]?.fields).toEqual([
        {
          key: "rooms",
          label: "Ambientes",
          before: "Antes: 2 ambientes, 3 itens",
          mine: "Sala (2 itens), Cozinha (1 item), Varanda (0 itens)",
          theirs: "Sala ampla (1 item)",
        },
      ]);
    });

    it("'meu': a lista daqui chega inteira ao servidor, na ordem, com If-Match do current, e o rascunho sai", async () => {
      const { api, store, drafts, drained } = await conflicted();
      const conflict = flatConflictOf<TemplateRecord>(drafts.get(confirmedV1.id))!;

      await resolveTemplateConflict(store, {
        resolved: resolveFlat(conflict, { rooms: "meu" }),
        server: conflict.server,
      });
      await drained(2);

      expect(api.sent).toHaveLength(2);
      expect(api.sent[1]?.ifMatch).toBe('"V2"');
      expect(api.current()).toEqual({ ...confirmedV1, rooms: mine, version: "V3" });
      expect(drafts.get(confirmedV1.id)?.status).not.toBe("conflict");
    });

    it("'servidor': fica a lista de lá, sem reenviar, e o rascunho sai", async () => {
      const { api, store, drafts } = await conflicted();
      const conflict = flatConflictOf<TemplateRecord>(drafts.get(confirmedV1.id))!;

      await resolveTemplateConflict(store, {
        resolved: resolveFlat(conflict, { rooms: "servidor" }),
        server: conflict.server,
      });

      expect(api.sent).toHaveLength(1);
      expect(api.current()).toEqual({ ...confirmedV1, rooms: theirs, version: "V2" });
      expect(drafts.get(confirmedV1.id)?.status).not.toBe("conflict");
    });
  });
});
