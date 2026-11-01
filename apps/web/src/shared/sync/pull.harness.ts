import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { expect, vi } from "vitest";

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
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import type { InspectionsCollection } from "@/features/inspections/services/inspections.collection";
import {
  DELETE_INSPECTION,
  UPSERT_INSPECTION,
  deleteInspectionMutation,
  inspectionsPull,
  saveInspection,
  upsertInspectionMutation,
} from "@/features/inspections/services/inspections.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import type { PropertiesCollection } from "@/features/properties/services/properties.collection";
import { propertiesPull } from "@/features/properties/services/properties.sync";

import type { DraftRecord, DraftsCollection } from "./drafts";
import { type Outbox, startOutbox } from "./outbox";
import {
  type CursorStore,
  type PullEntity,
  cursorStoreOf,
  pullOnce,
  queuedIds,
  skipMarksOf,
} from "./pull";
import { resetSyncStatus } from "./sync-status";
import type { SyncRecord } from "./upsert";
import { rowversionOf, versionOf } from "./version";

/** A `version` que o servidor falso dá à escrita `n` do relógio dele: o rowversion `n` em base64, como a API. */
export const V = (n: number) => versionOf(n);

// O pull de ponta a ponta, para os testes (`pull.test.ts` e `inspections.pull.test.ts`): a outbox e as mutationFns de
// verdade, uma collection com a camada otimista do TanStack DB por cima da store confirmada, e um servidor falso que,
// como a API, pagina o delta pela versão, confere o If-Match e responde 412 com o current (e 410 no excluído). Quem usa
// mocka `@/shared/auth/session` com `canSendAs` verdadeiro.

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

type Entity = "clients" | "properties" | "inspections";
type Row = SyncRecord & Record<string, unknown> & { seq: number; deleted?: boolean };

/** Quando o servidor falso excluiu um registro (o `deletedAt` do 410). */
export const DELETED_AT = "2026-10-29T11:00:00+00:00";

/**
 * O servidor falso. A versão é `V(n)`, o rowversion `n` em base64, de um relógio do banco inteiro; o cursor é o `n` da
 * última linha da página. `hold` segura as requisições de um caminho antes de o servidor ler; `holdAfter`, depois de ele
 * ler, com a resposta já pronta e entregue só na liberação.
 */
export function fakeApi({ pageSize = 500 } = {}) {
  let clock = 0;
  const tables: Record<Entity, Map<string, Row>> = {
    clients: new Map(),
    properties: new Map(),
    inspections: new Map(),
  };
  const requests: string[] = [];
  const holds: { prefix: string; until: Promise<void> }[] = [];
  const afterHolds: { prefix: string; until: Promise<void> }[] = [];
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

  /** Grava `row` numa versão nova, como um `PUT` aceito (ou a exclusão, com `deleted`); devolve a versão. */
  const write = (entity: Entity, row: SyncRecord & Record<string, unknown>, deleted = false) => {
    clock += 1;
    tables[entity].set(row.id, { ...row, version: V(clock), seq: clock, deleted });
    return V(clock);
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    const line = `${request.method} ${path}`;
    requests.push(line);
    const matches = (prefix: string) => path.startsWith(prefix) || line.startsWith(prefix);
    for (const hold of holds.filter((candidate) => matches(candidate.prefix))) await hold.until;
    const failure = failures.findIndex((candidate) => path.startsWith(candidate.prefix));
    if (failure >= 0) return failures.splice(failure, 1)[0]!.respond();
    const response = await answer(request, url);
    for (const hold of afterHolds.filter((candidate) => matches(candidate.prefix)))
      await hold.until;
    return response;
  };

  const answer = async (request: Request, url: URL): Promise<Response> => {
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
    if (current?.deleted) return problem("deleted", 410, { deletedAt: DELETED_AT });
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
      const seq = Number(rowversionOf(row.version)!);
      clock = Math.max(clock, seq);
      tables[entity].set(row.id, { ...row, seq });
    },
    current: (entity: Entity, id: string) => {
      const row = tables[entity].get(id);
      if (!row) return undefined;
      const { seq: _seq, deleted: _deleted, ...record } = row;
      return record;
    },
    /** Segura as requisições que começam com `prefix` (o caminho, ou o método e o caminho) até o `release`. */
    hold(prefix: string) {
      let release!: () => void;
      holds.push({ prefix, until: new Promise<void>((done) => (release = done)) });
      return () => release();
    },
    /**
     * Segura a resposta das requisições que começam com `prefix` (como no `hold`) depois de o servidor as ler: a resposta
     * tem o estado da hora da leitura e chega só no `release`.
     */
    holdAfter(prefix: string) {
      let release!: () => void;
      afterHolds.push({ prefix, until: new Promise<void>((done) => (release = done)) });
      return () => release();
    },
    /** A próxima requisição que começa com `prefix` responde `respond()`. */
    failNext(prefix: string, respond: () => Response) {
      failures.push({ prefix, respond });
    },
    problem,
  };
}

export type FakeApi = ReturnType<typeof fakeApi>;

let created = 0;

/**
 * A collection de uma entidade como a IndexedDB: a store confirmada (`utils`) sincroniza a collection, e a camada
 * otimista do TanStack DB fica por cima com o que está na fila. Diferente de uma `localOnly`, ela marca
 * `$hasPendingWrites`.
 */
export async function syncedStore<T extends SyncRecord>(initial: T[]) {
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
  /** A store inteira, como o `exportData` da IndexedDB. */
  const exportData = vi.fn<() => Promise<T[]>>(async () => [...confirmed.values()]);
  /** Só os ids pedidos, como o `readConfirmed` de `local-db.ts`. */
  const readConfirmed = vi.fn<(ids: readonly string[]) => Promise<T[]>>(async (ids) =>
    ids.flatMap((key) => confirmed.get(key) ?? []),
  );
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
    utils: { acceptMutations, exportData, readConfirmed },
  } as never);
  await collection.preload();
  return { collection, confirmed, acceptMutations, exportData, readConfirmed };
}

export const localOnly = <T extends { id: string }>(name: string) => {
  created += 1;
  return createCollection(
    localOnlyCollectionOptions<T, string>({ id: `${name}-${created}`, getKey: (row) => row.id }),
  );
};

let open: Outbox[] = [];
const stops: (() => void)[] = [];

/** Para os gatilhos do pull no fim do teste. */
export const stopLater = (stop: () => void) => {
  stops.push(stop);
};

/** O `afterEach` de quem usa o harness: fecha as outboxes e os gatilhos e limpa o estado de sync. */
export function closeDevices() {
  for (const outbox of open) outbox.dispose();
  for (const stop of stops.splice(0)) stop();
  open = [];
  resetSyncStatus();
  localStorage.clear();
}

/**
 * O aparelho: clientes, imóveis e vistorias já confirmados, os rascunhos, os cursores, as marcas, a outbox e o pull, na
 * ordem do `local-store.ts`.
 */
export async function device(
  api: FakeApi,
  {
    clients = [] as ClientRecord[],
    properties = [] as PropertyRecord[],
    inspections = [] as InspectionRecord[],
    cursors = undefined as CursorStore | undefined,
  } = {},
) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const clientStore = await syncedStore(clients);
  const propertyStore = await syncedStore(properties);
  const inspectionStore = await syncedStore(inspections);
  const drafts = localOnly<DraftRecord>("drafts") as unknown as DraftsCollection;
  const cursorRows = localOnly<{ id: string; cursor?: string }>("cursors");
  const skipped = localOnly<{ id: string; entity: string; recordId: string }>("skipped");
  const clientsCollection = clientStore.collection as unknown as ClientsCollection;
  const inspectionsCollection = inspectionStore.collection as unknown as InspectionsCollection;
  const outbox = startOutbox({
    ownerId: "ana",
    collections: { clients: clientStore.collection, inspections: inspectionStore.collection },
    mutationFns: {
      [UPSERT_CLIENT]: upsertClientMutation(clientsCollection, drafts, api.client),
      [UPSERT_INSPECTION]: upsertInspectionMutation(inspectionsCollection, drafts, api.client),
      [DELETE_INSPECTION]: deleteInspectionMutation(inspectionsCollection, drafts, api.client),
    },
    removals: new Set([DELETE_INSPECTION]),
  });
  open.push(outbox);
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
  const marks = skipMarksOf(skipped as never);
  const state = {
    drafts,
    cursors: cursors ?? cursorStoreOf(cursorRows as never),
    marks,
    queued: async () => queuedIds(await outbox.peekOutbox()),
  };
  const entities: PullEntity[] = [
    clientsPull(clientsCollection, api.client),
    propertiesPull(propertyStore.collection as unknown as PropertiesCollection, api.client),
    inspectionsPull(inspectionsCollection, api.client),
  ];
  return {
    clients: clientStore,
    properties: propertyStore,
    inspections: inspectionStore,
    drafts,
    cursorRows,
    marks,
    state,
    entities,
    outbox,
    pull: () => pullOnce(state, entities),
    /** Salva o formulário do cliente, como `useClientForm`. */
    saveClient: (values: ClientRecord) => {
      const { version: _version, ...rest } = values;
      saveClient({ clients: clientsCollection, drafts, outbox }, rest);
    },
    /** Põe a vistoria na fila, como a tela de campo. */
    saveInspection: (values: InspectionRecord) => {
      const { version: _version, ...rest } = values;
      saveInspection({ inspections: inspectionsCollection, drafts, outbox }, rest);
    },
    drained: () =>
      vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), { timeout: 5_000 }),
  };
}
