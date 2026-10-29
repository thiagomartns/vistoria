import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";

import type { ClientRecord } from "@/features/clients/models/client";
import type { ClientsCollection } from "@/features/clients/services/clients.collection";
import {
  UPSERT_CLIENT,
  clientsPull,
  saveClient,
  upsertClientMutation,
} from "@/features/clients/services/clients.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import type { PropertiesCollection } from "@/features/properties/services/properties.collection";
import { propertiesPull } from "@/features/properties/services/properties.sync";

import { expireSession } from "../auth/session";
import type { DraftRecord, DraftsCollection } from "./drafts";
import { type Outbox, startOutbox } from "./outbox";
import { type CursorStore, type PullEntity, cursorStoreOf, pullOnce, skipMarksOf } from "./pull";
import { startPull } from "./pull-triggers";
import { resetSyncStatus } from "./sync-status";
import type { SyncRecord } from "./upsert";

// O pull de ponta a ponta (frontend.md, "Leitura (pull)"; ADR 0041 e 0042): a outbox e a mutationFn de verdade, uma
// collection com a camada otimista do TanStack DB por cima da store confirmada, e um servidor falso que, como a API,
// pagina o delta pela versão, confere o If-Match e responde 412 com o current.

vi.mock("../auth/session", () => ({
  canSendAs: () => true,
  sessionStore: { subscribe: () => () => {} },
  expireSession: vi.fn<() => void>(),
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

const ID = "01a16032-2dfb-77de-84a2-1f165bdd9950";

/** O cliente como os dois aparelhos o confirmaram (V1). */
const clientV1: ClientRecord = {
  id: ID,
  version: "V1",
  name: "Imobiliária Alfa",
  document: null,
  email: "contato@alfa.com",
  phone: null,
};

const clientOf = (n: number): ClientRecord => ({
  ...clientV1,
  id: `01a16032-2dfb-77de-84a2-1f165bdd99${String(n).padStart(2, "0")}`,
  name: `Cliente ${n}`,
});

const propertyOf = (clientId: string): PropertyRecord => ({
  id: "01a16032-2dfb-77de-84a2-1f165bdd9a00",
  version: null,
  clientId,
  street: "Rua Direita",
  number: "10",
  complement: null,
  district: "Centro",
  city: "Salvador",
  state: "BA",
  zipCode: "40020000",
  type: "apartment",
  notes: null,
});

type Entity = "clients" | "properties";
type Row = SyncRecord & Record<string, unknown> & { seq: number; deleted?: boolean };

/**
 * O servidor falso. A versão é `V<n>`, com `n` de um relógio do banco inteiro, como o rowversion; o cursor é o `n` da
 * última linha da página. `hold` segura as respostas de um caminho até a liberação.
 */
function fakeApi({ pageSize = 500 } = {}) {
  let clock = 0;
  const tables: Record<Entity, Map<string, Row>> = { clients: new Map(), properties: new Map() };
  const requests: string[] = [];
  const holds: { prefix: string; until: Promise<void> }[] = [];
  const failures: { prefix: string; respond: () => Response }[] = [];

  const problem = (type: string, status: number, extra: Record<string, unknown> = {}) =>
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
  const dtoOf = ({ seq: _seq, deleted: _deleted, ...row }: Row) => ({
    ...row,
    createdAt: "2026-10-21T00:00:00+00:00",
    updatedAt: "2026-10-29T09:00:00+00:00",
  });

  /** Grava `row` numa versão nova, como um `PUT` aceito; devolve a versão. */
  const write = (entity: Entity, row: SyncRecord & Record<string, unknown>, deleted = false) => {
    clock += 1;
    tables[entity].set(row.id, { ...row, version: `V${clock}`, seq: clock, deleted });
    return `V${clock}`;
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    requests.push(`${request.method} ${path}`);
    for (const hold of holds.filter((candidate) => path.startsWith(candidate.prefix)))
      await hold.until;
    const failure = failures.findIndex((candidate) => path.startsWith(candidate.prefix));
    if (failure >= 0) return failures.splice(failure, 1)[0]!.respond();

    const [, , , first, second] = url.pathname.split("/");
    if (first === "sync") {
      const entity = second as Entity;
      const cursor = url.searchParams.get("cursor");
      const after = cursor ? Number(cursor) : 0;
      const changed = [...tables[entity].values()]
        .filter((row) => row.seq > after && (cursor || !row.deleted))
        .toSorted((a, b) => a.seq - b.seq);
      const page = changed.slice(0, pageSize);
      return Response.json({
        items: page.filter((row) => !row.deleted).map(dtoOf),
        deletedIds: page.filter((row) => row.deleted).map((row) => row.id),
        nextCursor: String(page.at(-1)?.seq ?? after),
        hasMore: changed.length > pageSize,
      });
    }
    const entity = first as Entity;
    const current = tables[entity].get(second!);
    if (request.method === "GET") {
      return current && !current.deleted
        ? Response.json(dtoOf(current))
        : problem("not-found", 404);
    }
    const body = (await request.json()) as Record<string, unknown>;
    if (current && request.headers.get("If-Match") !== `"${current.version}"`) {
      return problem("version-conflict", 412, { current: dtoOf(current) });
    }
    write(entity, { ...body, id: second!, version: null });
    return Response.json(dtoOf(tables[entity].get(second!)!), { status: current ? 200 : 201 });
  };

  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: (input) => handle(input as Request),
  });

  return {
    client,
    requests,
    write,
    /** Grava como o aparelho já confirmou: a versão vem de `row`, e o relógio a acompanha. */
    seed(entity: Entity, row: SyncRecord & Record<string, unknown>) {
      const seq = Number(row.version!.slice(1));
      clock = Math.max(clock, seq);
      tables[entity].set(row.id, { ...row, seq });
    },
    current: (entity: Entity, id: string) => {
      const row = tables[entity].get(id);
      if (!row) return undefined;
      const { seq: _seq, deleted: _deleted, ...record } = row;
      return record;
    },
    /** Segura as requisições que começam com `prefix` até o `release`. */
    hold(prefix: string) {
      let release!: () => void;
      holds.push({ prefix, until: new Promise<void>((done) => (release = done)) });
      return () => release();
    },
    /** A próxima requisição que começa com `prefix` responde `respond()`. */
    failNext(prefix: string, respond: () => Response) {
      failures.push({ prefix, respond });
    },
    problem,
  };
}

let created = 0;

/**
 * A collection de uma entidade como a IndexedDB: a store confirmada (`utils`) sincroniza a collection, e a camada
 * otimista do TanStack DB fica por cima com o que está na fila. Diferente de uma `localOnly`, ela marca
 * `$hasPendingWrites`.
 */
async function syncedStore<T extends SyncRecord>(initial: T[]) {
  const confirmed = new Map(initial.map((row) => [row.id, row]));
  type Channel = {
    begin: () => void;
    write: (message: unknown) => void;
    commit: () => void;
    markReady: () => void;
  };
  let channel: Channel | undefined;
  const acceptMutations = vi.fn<
    (transaction: { mutations: { type: string; modified: T }[] }) => Promise<void>
  >(async ({ mutations }) => {
    channel!.begin();
    for (const { type, modified } of mutations) {
      if (type === "delete") {
        confirmed.delete(modified.id);
        channel!.write({ type: "delete", key: modified.id });
      } else {
        confirmed.set(modified.id, modified);
        channel!.write({ type: "update", value: modified });
      }
    }
    channel!.commit();
  });
  created += 1;
  const collection = createCollection<T, string>({
    id: `synced-${created}`,
    getKey: (row: T) => row.id,
    sync: {
      rowUpdateMode: "full",
      sync: (params: Channel) => {
        channel = params;
        params.begin();
        for (const row of initial) params.write({ type: "insert", value: row });
        params.commit();
        params.markReady();
      },
    },
    utils: { acceptMutations, exportData: async () => [...confirmed.values()] },
  } as never);
  await collection.preload();
  return { collection, confirmed, acceptMutations };
}

const localOnly = <T extends { id: string }>(name: string) => {
  created += 1;
  return createCollection(
    localOnlyCollectionOptions<T, string>({ id: `${name}-${created}`, getKey: (row) => row.id }),
  );
};

let open: Outbox[] = [];
let stops: (() => void)[] = [];

afterEach(() => {
  for (const outbox of open) outbox.dispose();
  for (const stop of stops) stop();
  open = [];
  stops = [];
  resetSyncStatus();
  localStorage.clear();
  vi.mocked(expireSession).mockClear();
  vi.restoreAllMocks();
});

/** O aparelho: clientes e imóveis já confirmados, os rascunhos, os cursores, as marcas, a outbox e o pull. */
async function device(
  api: ReturnType<typeof fakeApi>,
  {
    clients = [] as ClientRecord[],
    properties = [] as PropertyRecord[],
    cursors = undefined as CursorStore | undefined,
  } = {},
) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const clientStore = await syncedStore(clients);
  const propertyStore = await syncedStore(properties);
  const drafts = localOnly<DraftRecord>("drafts") as unknown as DraftsCollection;
  const cursorRows = localOnly<{ id: string; cursor: string }>("cursors");
  const skipped = localOnly<{ id: string; entity: string; recordId: string }>("skipped");
  const clientsCollection = clientStore.collection as unknown as ClientsCollection;
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { clients: clientStore.collection },
    mutationFns: { [UPSERT_CLIENT]: upsertClientMutation(clientsCollection, drafts, api.client) },
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  const marks = skipMarksOf(skipped as never);
  const state = { drafts, cursors: cursors ?? cursorStoreOf(cursorRows as never), marks };
  const entities: PullEntity[] = [
    clientsPull(clientsCollection, api.client),
    propertiesPull(propertyStore.collection as unknown as PropertiesCollection, api.client),
  ];
  return {
    clients: clientStore,
    properties: propertyStore,
    drafts,
    cursorRows,
    marks,
    state,
    entities,
    outbox,
    pull: () => pullOnce(state, entities),
    /** Salva o formulário do cliente, como `useClientForm`. */
    save: (values: Partial<ClientRecord>) => {
      const { id: _id, version: _version, ...rest } = { ...clientV1, ...values };
      saveClient({ clients: clientsCollection, drafts, outbox }, { id: ID, ...rest });
    },
    drained: () =>
      vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 }),
  };
}

const draftOf = (status: DraftRecord["status"]): DraftRecord => ({
  id: ID,
  entity: "client",
  data: { ...clientV1, phone: "(71) 4444-0000" },
  status,
  errors: status === "rejected" ? { phone: ["Telefone inválido."] } : {},
  ...(status === "conflict" && { conflict: { current: clientV1, collisions: [] } }),
  updatedAt: "2026-10-29T10:00:00.000Z",
});

describe("pull: registro com pendência (ADR 0041)", () => {
  it("transação na fila (em voo): a store confirmada fica na V1 e o registro ganha a marca", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
    const phone = await device(api, { clients: [clientV1] });
    const release = api.hold("/api/v1/clients/");
    phone.save({ phone: "(71) 4444-0000" });
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/clients/${ID}`));

    expect(await phone.pull()).toBe("done");

    expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
    expect(phone.marks.list("clients")).toEqual([ID]);
    release();
  });

  it("não perder: o Telefone daqui na fila e o Nome do outro aparelho no pull convergem pelo 412, sem colisão", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });
    const release = api.hold("/api/v1/clients/");
    phone.save({ phone: "(71) 4444-0000" });
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/clients/${ID}`));
    // O outro aparelho muda o Nome enquanto o envio daqui está em voo.
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });

    await phone.pull();
    expect(phone.clients.confirmed.get(ID)?.version).toBe("V1");

    release();
    await phone.drained();
    const merged = { ...clientV1, name: "Alfa Imóveis", phone: "(71) 4444-0000" };
    expect(api.current("clients", ID)).toEqual({ ...merged, version: "V3" });
    expect(phone.drafts.size).toBe(0);

    // A marca sai no ciclo seguinte, pelo GET: a store fica com o que os dois gravaram.
    await phone.pull();
    expect(phone.clients.confirmed.get(ID)).toEqual({ ...merged, version: "V3" });
    expect(phone.marks.list("clients")).toEqual([]);
  });

  it.each(["draft", "rejected", "conflict"] as const)(
    "rascunho %s: nem a store nem o rascunho mudam, e o registro ganha a marca",
    async (status) => {
      const api = fakeApi();
      api.seed("clients", clientV1);
      api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
      const phone = await device(api, { clients: [clientV1] });
      phone.drafts.insert(draftOf(status));

      await phone.pull();

      expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
      expect(phone.clients.acceptMutations).not.toHaveBeenCalled();
      expect(phone.drafts.get(ID)).toMatchObject(draftOf(status));
      expect(phone.drafts.get(ID)).not.toHaveProperty("rebasedAt");
      expect(phone.marks.list("clients")).toEqual([ID]);
    },
  );

  it("a pendência é a da hora de aplicar: uma escrita feita com a página em voo vence", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
    const phone = await device(api, { clients: [clientV1] });
    const releasePage = api.hold("/api/v1/sync/clients");
    api.hold("/api/v1/clients/"); // o envio fica em voo até o fim do teste

    const pulling = phone.pull();
    await vi.waitFor(() =>
      expect(api.requests.some((r) => r.startsWith("GET /api/v1/sync/clients"))).toBe(true),
    );
    phone.save({ phone: "(71) 4444-0000" });
    releasePage();
    await pulling;

    expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
    expect(phone.marks.list("clients")).toEqual([ID]);
  });

  it("a pendência some sem envio (rascunho descartado): o ciclo seguinte busca a versão do servidor e tira a marca", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
    const phone = await device(api, { clients: [clientV1] });
    phone.drafts.insert(draftOf("rejected"));
    const triggers = startPull({ ownerId: "ana", run: phone.pull, drafts: phone.drafts });
    stops.push(triggers.dispose);
    await vi.waitFor(() => expect(phone.marks.list("clients")).toEqual([ID]));

    // Descartar o rascunho é um gatilho: nenhuma outra mudança no servidor é preciso.
    phone.drafts.delete(ID);

    await vi.waitFor(() => expect(phone.marks.list("clients")).toEqual([]));
    expect(phone.clients.confirmed.get(ID)).toEqual({
      ...clientV1,
      name: "Alfa Imóveis",
      version: "V2",
    });
    expect(api.requests).toContain(`GET /api/v1/clients/${ID}`);
  });

  it("eco da própria escrita: o item com a version da store não regrava o registro", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });

    expect(await phone.pull()).toBe("done");

    expect(phone.clients.acceptMutations).not.toHaveBeenCalled();
    expect(phone.marks.list("clients")).toEqual([]);
  });
});

describe("pull: o laço por entidade", () => {
  it("sem pendência: o registro recebe a versão do servidor, o excluído sai, e clientes vêm antes de imóveis", async () => {
    const api = fakeApi();
    const removed = clientOf(1);
    api.seed("clients", clientV1);
    api.seed("clients", { ...removed, version: "V2" });
    api.write("clients", { ...clientV1, email: "vendas@alfa.com" });
    api.write("clients", removed, true);
    const property = propertyOf(ID);
    api.write("properties", property);
    const phone = await device(api, { clients: [clientV1, { ...removed, version: "V2" }] });
    // A partir do cursor de quem já tinha a V1 e a V2.
    await phone.state.cursors.set("clients", "2");

    expect(await phone.pull()).toBe("done");

    expect([...phone.clients.confirmed.values()]).toEqual([
      { ...clientV1, email: "vendas@alfa.com", version: "V3" },
    ]);
    expect([...phone.properties.confirmed.values()]).toEqual([{ ...property, version: "V5" }]);
    expect(phone.clients.collection.get(ID)?.email).toBe("vendas@alfa.com");
    expect(api.requests).toEqual([
      "GET /api/v1/sync/clients?cursor=2",
      "GET /api/v1/sync/properties",
    ]);
  });

  it("três páginas em ordem; derrubada a terceira, repetir retoma dela sem baixar as duas primeiras", async () => {
    const api = fakeApi({ pageSize: 2 });
    for (let n = 1; n <= 5; n += 1) api.write("clients", clientOf(n));
    const phone = await device(api);
    api.failNext("/api/v1/sync/clients?cursor=4", () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await phone.pull()).toBe("offline");
    expect(phone.state.cursors.get("clients")).toBe("4");
    expect(phone.clients.confirmed.size).toBe(4);

    api.requests.length = 0;
    expect(await phone.pull()).toBe("done");

    expect(api.requests).toEqual([
      "GET /api/v1/sync/clients?cursor=4",
      "GET /api/v1/sync/properties",
    ]);
    expect([...phone.clients.confirmed.keys()]).toEqual([1, 2, 3, 4, 5].map((n) => clientOf(n).id));
  });

  it("caiu entre a página e o cursor: a mesma página volta, e reaplicá-la não regrava nada", async () => {
    const api = fakeApi({ pageSize: 2 });
    for (let n = 1; n <= 3; n += 1) api.write("clients", clientOf(n));
    const saved = new Map<string, string>();
    let failures = 1;
    const cursors: CursorStore = {
      get: (entity) => saved.get(entity),
      set: async (entity, cursor) => {
        if (cursor === "3" && failures-- > 0) throw new Error("aba fechada");
        saved.set(entity, cursor);
      },
    };
    const phone = await device(api, { cursors });

    await expect(phone.pull()).rejects.toThrow("aba fechada");
    expect(phone.clients.confirmed.size).toBe(3);
    phone.clients.acceptMutations.mockClear();

    expect(await phone.pull()).toBe("done");

    expect(api.requests.filter((r) => r.includes("sync/clients"))).toEqual([
      "GET /api/v1/sync/clients",
      "GET /api/v1/sync/clients?cursor=2",
      "GET /api/v1/sync/clients?cursor=2",
    ]);
    expect(phone.clients.acceptMutations).not.toHaveBeenCalled();
    expect(saved.get("clients")).toBe("3");
  });

  it("unauthorized: expira a sessão e para o ciclo, sem puxar imóveis", async () => {
    const api = fakeApi();
    const phone = await device(api);
    api.failNext("/api/v1/sync/clients", () => api.problem("unauthorized", 401));

    expect(await phone.pull()).toBe("failed");

    expect(expireSession).toHaveBeenCalledOnce();
    expect(api.requests).toEqual(["GET /api/v1/sync/clients"]);
  });

  it("sem rede: nem pede, e o cursor fica", async () => {
    const api = fakeApi();
    const phone = await device(api);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    expect(await phone.pull()).toBe("offline");

    expect(api.requests).toEqual([]);
    expect(phone.state.cursors.get("clients")).toBeUndefined();
  });
});
