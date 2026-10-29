import {
  type IndexedDBInstance,
  type PendingMutation,
  createCollection,
  indexedDBCollectionOptions,
} from "@tanstack/db";

import { expireSession } from "../auth/session";
import { readFailure } from "../api/client";
import { handleProblem } from "../api/problems";
import type { DraftsCollection } from "./drafts";
import { type GetCall, hasPending, refetchById } from "./fetch";
import type { LocalCollection, SyncRecord } from "./upsert";

// O pull por delta (frontend.md, "Leitura (pull)"): um laço por entidade, cada um com o seu cursor, repetido enquanto
// `hasMore` for verdadeiro. O pull não toca registro com pendência (ADR 0041): ele ganha uma marca, resolvida pelo `GET`
// por id no começo de um ciclo em que a pendência já tenha sumido.
// A página não cabe numa transação local com o cursor: a collection IndexedDB grava cada store na sua. Por isso a ordem
// é registros, marcas e só então o cursor (ADR 0042). Se o pull cair no meio, a mesma página volta, e reaplicá-la não
// muda nada: o eco pela `version`, a exclusão do que já saiu e a marca que já existe.

/** Uma página do delta (`SyncPageDto` do backend.md, "Leitura por delta"). */
export interface SyncPage<D> {
  items: D[];
  deletedIds: string[];
  nextCursor: string;
  hasMore: boolean;
}

/** A chamada gerada do `GET /api/v1/sync/<entidade>`. */
export type PageCall<D> = (request: {
  query: { cursor?: string };
}) => Promise<{ data?: SyncPage<D>; error?: unknown; response?: Response }>;

/** Um laço do pull: a entidade, a store dela e as chamadas do delta e do `GET` por id. */
export interface PullEntity<T extends SyncRecord = any, D = any> {
  /** O nome do laço, que dá nome ao cursor e às marcas ("clients"). */
  name: string;
  store: LocalCollection<T>;
  page: PageCall<D>;
  get: GetCall<D>;
  /** O DTO do servidor na forma do registro local, com a `version`. */
  shape: (dto: D) => T;
}

/** O cursor de cada laço, no banco local do usuário. Vazio é o primeiro sync. */
export interface CursorStore {
  get: (entity: string) => string | undefined;
  set: (entity: string, cursor: string) => Promise<void>;
}

/** As marcas dos registros que o pull pulou por ter pendência: entidade e id, sem a versão (ADR 0041). */
export interface SkipMarks {
  list: (entity: string) => string[];
  add: (entity: string, ids: string[]) => Promise<void>;
  remove: (entity: string, id: string) => Promise<void>;
}

export interface PullState {
  drafts: DraftsCollection;
  cursors: CursorStore;
  marks: SkipMarks;
}

/**
 * - `done`: todos os laços chegaram ao fim (`hasMore` falso).
 * - `offline`: sem rede; o cursor fica na última página aplicada, e o próximo gatilho tenta de novo.
 * - `failed`: o servidor recusou (a sessão expirou, o cursor venceu ou outro erro); o ciclo parou.
 */
export type PullOutcome = "done" | "offline" | "failed";

/**
 * Um ciclo de pull: primeiro as marcas, depois cada laço na ordem de `entities` (o pai antes do filho, cliente antes do
 * imóvel). Um laço que não chega ao fim para o ciclo: o filho não é puxado sem o pai.
 */
export async function pullOnce(
  state: PullState,
  entities: readonly PullEntity[],
): Promise<PullOutcome> {
  if (globalThis.navigator?.onLine === false) return "offline";
  for (const entity of entities) {
    if ((await resolveMarks(state, entity)) === "offline") return "offline";
  }
  for (const entity of entities) {
    const outcome = await pullEntity(state, entity);
    if (outcome !== "done") return outcome;
  }
  return "done";
}

/**
 * A marca de um registro que já não tem pendência vai ao `GET` por id (`refetchById`), com a mesma regra: se a
 * pendência voltou durante ele, a resposta é descartada e a marca fica. O 404 remove o registro local; sem rede ou com
 * falha, a marca fica para o próximo ciclo.
 */
async function resolveMarks(state: PullState, entity: PullEntity): Promise<PullOutcome> {
  for (const id of state.marks.list(entity.name)) {
    if (hasPending(entity.store, state.drafts, id)) continue;
    const outcome = await refetchById({
      store: entity.store,
      drafts: state.drafts,
      id,
      get: entity.get,
      shape: entity.shape,
    });
    if (outcome === "found" || outcome === "not-found") await state.marks.remove(entity.name, id);
    if (outcome === "offline") return "offline";
  }
  return "done";
}

async function pullEntity(state: PullState, entity: PullEntity): Promise<PullOutcome> {
  for (;;) {
    const cursor = state.cursors.get(entity.name);
    const result = await entity.page({ query: cursor ? { cursor } : {} });
    if (!result.data) return failureOf(entity, result);
    await applyPage(state, entity, result.data);
    if (!result.data.hasMore) return "done";
  }
}

// A reação vem do grupo do `type` (frontend.md, "Reação aos erros"), nunca do status.
function failureOf(
  entity: PullEntity,
  result: { error?: unknown; response?: Response },
): PullOutcome {
  const failure = readFailure({ error: result.error, response: result.response });
  if (failure.kind === "network") return "offline";
  const group = handleProblem(failure);
  if (group === "renew-session") {
    expireSession();
  } else {
    // `resync` (cursor vencido ou ilegível): o resync completo da entidade é da #131; até lá, o ciclo só para.
    console.warn("[pull] página recusada", entity.name, group, failure);
  }
  return "failed";
}

/**
 * Aplica uma página: os `items` vão para a store confirmada e os `deletedIds` saem dela, menos os de registro com
 * pendência, que ganham a marca. Um item com a `version` que a store já tem é o eco da própria escrita: não regrava o
 * registro. A pendência é a da hora de aplicar, não a de quando a requisição saiu: entre a conferência e a gravação não
 * há `await`, então uma escrita feita com a página em voo vence. O cursor só é gravado depois.
 */
async function applyPage(
  state: PullState,
  entity: PullEntity,
  page: SyncPage<unknown>,
): Promise<void> {
  const { store } = entity;
  const confirmed = new Map((await store.utils.exportData()).map((record) => [record.id, record]));
  const skipped: string[] = [];
  const mutations: { type: "insert" | "update" | "delete"; key: string; modified: SyncRecord }[] =
    [];
  for (const dto of page.items) {
    const record = entity.shape(dto);
    const known = confirmed.get(record.id);
    if (hasPending(store, state.drafts, record.id)) skipped.push(record.id);
    else if (known?.version !== record.version) {
      mutations.push({ type: known ? "update" : "insert", key: record.id, modified: record });
    }
  }
  for (const id of page.deletedIds) {
    const known = confirmed.get(id);
    if (hasPending(store, state.drafts, id)) skipped.push(id);
    else if (known) mutations.push({ type: "delete", key: id, modified: known });
  }
  if (mutations.length > 0) {
    // Na 0.15, acceptMutations tipa as mutações como Record<string, unknown>, não pelo item da collection.
    await store.utils.acceptMutations({
      mutations: mutations.map((mutation) => ({ ...mutation, collection: store })),
    } as unknown as { mutations: PendingMutation[] });
  }
  if (skipped.length > 0) await state.marks.add(entity.name, skipped);
  await state.cursors.set(entity.name, page.nextCursor);
}

// Cursores e marcas no banco local do usuário, uma collection IndexedDB cada, como os rascunhos. Saem com o banco.

interface CursorRow {
  /** O nome do laço ("clients"). */
  id: string;
  cursor: string;
}

interface SkipMarkRow {
  /** `<entidade>:<id>`. */
  id: string;
  entity: string;
  recordId: string;
}

export function createCursorsCollection(db: IndexedDBInstance) {
  return createCollection(
    indexedDBCollectionOptions<CursorRow, string>({ db, name: "cursors", getKey: (row) => row.id }),
  );
}

export function createSkipMarksCollection(db: IndexedDBInstance) {
  return createCollection(
    indexedDBCollectionOptions<SkipMarkRow, string>({
      db,
      name: "skipped",
      getKey: (row) => row.id,
    }),
  );
}

export type CursorsCollection = ReturnType<typeof createCursorsCollection>;
export type SkipMarksCollection = ReturnType<typeof createSkipMarksCollection>;

/** O `CursorStore` sobre a collection: cada gravação só termina depois de persistida. */
export function cursorStoreOf(
  cursors: Pick<CursorsCollection, "get" | "has" | "insert" | "update">,
): CursorStore {
  return {
    get: (entity) => cursors.get(entity)?.cursor,
    async set(entity, cursor) {
      const transaction = cursors.has(entity)
        ? cursors.update(entity, (row) => {
            row.cursor = cursor;
          })
        : cursors.insert({ id: entity, cursor });
      await transaction.isPersisted.promise;
    },
  };
}

const markKey = (entity: string, id: string) => `${entity}:${id}`;

/** As `SkipMarks` sobre a collection: marcar de novo um registro já marcado não grava nada. */
export function skipMarksOf(
  marks: Pick<SkipMarksCollection, "has" | "insert" | "delete" | "toArray">,
): SkipMarks {
  return {
    list: (entity) =>
      marks.toArray.filter((row) => row.entity === entity).map((row) => row.recordId),
    async add(entity, ids) {
      const fresh = [...new Set(ids)].filter((id) => !marks.has(markKey(entity, id)));
      if (fresh.length === 0) return;
      await marks.insert(
        fresh.map((recordId) => ({ id: markKey(entity, recordId), entity, recordId })),
      ).isPersisted.promise;
    },
    async remove(entity, id) {
      if (!marks.has(markKey(entity, id))) return;
      await marks.delete(markKey(entity, id)).isPersisted.promise;
    },
  };
}
