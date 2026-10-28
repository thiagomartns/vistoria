import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftRecord, DraftsCollection } from "@/shared/sync/drafts";
import { type ConflictChoice, flatConflictOf, resolveFlat } from "@/shared/sync/flat-conflict";
import { type Outbox, startOutbox } from "@/shared/sync/outbox";
import { conflictItems } from "@/shared/sync/sync-view";

import type { ClientRecord } from "../models/client";
import type { ClientsCollection } from "./clients.collection";
import {
  UPSERT_CLIENT,
  resolveClientConflict,
  saveClient,
  upsertClientMutation,
} from "./clients.sync";

// O conflito de cliente de ponta a ponta (frontend.md, "Conflito"; ADR 0038), com o executor e a mutationFn de verdade
// contra um servidor falso que, como a API, confere o If-Match, responde 412 com o current e reavalia o CPF/CNPJ.

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

// O cliente como o aparelho o confirmou por último (V1).
const confirmedV1: ClientRecord = {
  id: "01a16032-2dfb-77de-84a2-1f165bdd9950",
  version: "V1",
  name: "Imobiliária Alfa",
  document: null,
  email: "contato@alfa.com",
  phone: null,
};

/** Um CPF que, no servidor, já é de outro cliente. */
const TAKEN = "52998224725";

/**
 * O servidor falso: guarda o cliente, responde 412 com o current quando o If-Match difere, 400 `validation` para o
 * documento repetido e, senão, grava o corpo numa versão nova. Anota cada `PUT`.
 */
function fakeServer(initial: ClientRecord) {
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
      const body = (await request.json()) as Omit<ClientRecord, "id" | "version">;
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
      if (body.document === TAKEN) {
        return problem("validation", 400, { errors: { document: ["CPF ou CNPJ já cadastrado."] } });
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
  const confirmed = new Map<string, ClientRecord>([[confirmedV1.id, confirmedV1]]);
  const drafts = new Map<string, DraftRecord>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: DraftRecord) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: DraftRecord) => void) => change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  const optimistic = createCollection(
    localOnlyCollectionOptions<ClientRecord, string>({ id: "clients", getKey: (row) => row.id }),
  );
  const clients = {
    get: (id: string) => optimistic.get(id) ?? confirmed.get(id),
    has: (id: string) => optimistic.has(id),
    insert: (row: ClientRecord) => optimistic.insert(row),
    update: (id: string, change: (row: ClientRecord) => void) => optimistic.update(id, change),
    utils: {
      exportData: async () => [...confirmed.values()],
      acceptMutations: async ({ mutations }: { mutations: { modified: ClientRecord }[] }) => {
        for (const { modified } of mutations) confirmed.set(modified.id, modified);
      },
    },
  } as unknown as ClientsCollection;
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { clients: optimistic },
    mutationFns: {
      [UPSERT_CLIENT]: upsertClientMutation(clients, draftsCollection, server.client),
    },
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  const store = { clients, drafts: draftsCollection, outbox };
  const drained = (sent: number) =>
    vi.waitFor(
      async () => {
        expect(server.sent.length).toBeGreaterThanOrEqual(sent);
        expect(await outbox.peekOutbox()).toHaveLength(0);
      },
      { timeout: 5_000 },
    );
  /** Salva o formulário, como `useClientForm`. */
  const save = (values: Partial<ClientRecord>) => {
    const { id: _id, version: _version, ...rest } = { ...confirmedV1, ...values };
    saveClient(store, { id: confirmedV1.id, ...rest });
  };
  return { store, confirmed, drafts, save, drained, outbox };
}

/** O outro aparelho gravou `change` em cima da V1 (a V2). */
const elsewhere = (change: Partial<ClientRecord>) =>
  fakeServer({ ...confirmedV1, ...change, version: "V2" });

describe("conflito de cliente", () => {
  it("campos diferentes: converge sem perguntar, num reenvio com If-Match do current e chave nova", async () => {
    const api = elsewhere({ email: "vendas@alfa.com" });
    const { save, drained, drafts, confirmed } = await start(api);

    save({ phone: "(71) 4444-0000" });
    await drained(2);

    expect(api.sent).toHaveLength(2);
    expect(api.sent[0]?.ifMatch).toBe('"V1"');
    expect(api.sent[1]?.ifMatch).toBe('"V2"');
    expect(api.sent[1]?.key).not.toBe(api.sent[0]?.key);
    expect(api.current()).toEqual({
      ...confirmedV1,
      email: "vendas@alfa.com",
      phone: "(71) 4444-0000",
      version: "V3",
    });
    expect(confirmed.get(confirmedV1.id)).toEqual(api.current());
    expect(drafts.size).toBe(0);
  });

  describe("o mesmo campo dos dois lados", () => {
    /** Aqui o telefone e o nome; lá o telefone e o e-mail. O telefone colide. */
    async function conflicted() {
      const api = elsewhere({ phone: "(71) 3333-0000", email: "vendas@alfa.com" });
      const started = await start(api);
      started.save({ phone: "(71) 4444-0000", name: "Alfa Imóveis" });
      await started.drained(1);
      const draft = started.drafts.get(confirmedV1.id);
      expect(draft?.status).toBe("conflict");
      return { api, ...started };
    }

    it("não reenvia sozinho e aparece em 'Ação necessária', com a rota do resolver", async () => {
      const { api, drafts } = await conflicted();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(api.sent).toHaveLength(1);
      const conflict = flatConflictOf<ClientRecord>(drafts.get(confirmedV1.id))!;
      expect(conflict.collisions.map((collision) => collision.field)).toEqual(["phone"]);
      expect(conflictItems([...drafts.values()])).toEqual([
        expect.objectContaining({
          title: "Cliente · Alfa Imóveis",
          href: `/clients/conflict?id=${confirmedV1.id}`,
        }),
      ]);
    });

    it("salvar o formulário de novo não enfileira: fica no rascunho, que o resolver usa", async () => {
      const { api, save, drafts, outbox } = await conflicted();

      save({ phone: "(71) 5555-0000", name: "Alfa Imóveis" });

      expect(await outbox.peekOutbox()).toHaveLength(0);
      expect(api.sent).toHaveLength(1);
      const draft = drafts.get(confirmedV1.id)!;
      expect(draft.status).toBe("conflict");
      expect(flatConflictOf<ClientRecord>(draft)!.collisions).toEqual([
        { field: "phone", base: null, local: "(71) 5555-0000", server: "(71) 3333-0000" },
      ]);
    });

    it.each<[string, ConflictChoice, string]>([
      ["meu", "meu", "(71) 4444-0000"],
      ["servidor", "servidor", "(71) 3333-0000"],
    ])(
      "'%s': a escolha chega ao servidor, com If-Match do current e chave nova, e o rascunho sai",
      async (_name, choice, phone) => {
        const { api, store, drafts, confirmed, drained } = await conflicted();
        const conflict = flatConflictOf<ClientRecord>(drafts.get(confirmedV1.id))!;

        await resolveClientConflict(store, {
          resolved: resolveFlat(conflict, { phone: choice }),
          server: conflict.server,
        });
        await drained(2);

        expect(api.sent).toHaveLength(2);
        expect(api.sent[1]?.ifMatch).toBe('"V2"');
        expect(api.sent[1]?.key).not.toBe(api.sent[0]?.key);
        expect(api.current()).toEqual({
          ...confirmedV1,
          name: "Alfa Imóveis",
          email: "vendas@alfa.com",
          phone,
          version: "V3",
        });
        expect(confirmed.get(confirmedV1.id)).toEqual(api.current());
        expect(drafts.size).toBe(0);
      },
    );

    it("tudo igual ao servidor: só adota o current, sem PUT", async () => {
      const api = elsewhere({ phone: "(71) 3333-0000" });
      const { save, drained, drafts, store, confirmed } = await start(api);
      save({ phone: "(71) 4444-0000" });
      await drained(1);
      const conflict = flatConflictOf<ClientRecord>(drafts.get(confirmedV1.id))!;

      await resolveClientConflict(store, {
        resolved: resolveFlat(conflict, { phone: "servidor" }),
        server: conflict.server,
      });

      expect(api.sent).toHaveLength(1);
      expect(confirmed.get(confirmedV1.id)).toEqual(conflict.server);
      expect(drafts.size).toBe(0);
    });

    it("o servidor reavalia o CPF no reenvio: a recusa vira rascunho recusado, com o erro no campo", async () => {
      const api = elsewhere({ document: "11144477735" });
      const { save, drained, drafts, store } = await start(api);
      save({ document: TAKEN });
      await drained(1);
      const conflict = flatConflictOf<ClientRecord>(drafts.get(confirmedV1.id))!;

      await resolveClientConflict(store, {
        resolved: resolveFlat(conflict, { document: "meu" }),
        server: conflict.server,
      });
      await drained(2);

      expect(api.sent[1]?.body.document).toBe(TAKEN);
      expect(drafts.get(confirmedV1.id)).toMatchObject({
        status: "rejected",
        errors: { document: ["CPF ou CNPJ já cadastrado."] },
      });
    });
  });
});
