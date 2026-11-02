import {
  type Collection,
  type IndexedDBInstance,
  type LoadSubsetOptions,
  type PendingMutation,
  type SyncConfig,
  createCollection,
  executeTransaction,
  extractSimpleComparisons,
  getAll,
} from "@tanstack/db";

import { readConfirmed } from "./local-db";

// Uma entidade grande demais para abrir inteira (spike 2, ADR 0048): a store `name` guarda o registro completo e a
// `summaryName`, um resumo de cada um, gravados na mesma transação IndexedDB, então os dois nunca divergem. A collection
// do registro é on-demand e carrega só o que uma consulta por id pede. O resumo é o que a lista lê, inteiro e só para
// leitura: fica numa store em memória simples (`SummaryStore`), não numa collection. Com 10 mil, montar a collection
// custava uns 300 ms no celular, e o resumo não tem camada otimista: a fila vem por cima na própria lista.
// A gravação é a mesma da collection IndexedDB do TanStack DB: a store só aceita o que vem por `acceptMutations`, que
// grava e então confirma na memória. Leituras, gravações e mudanças vindas de outra aba passam por uma fila só, para a
// memória ver as gravações na ordem do IndexedDB.

/** O store de metadados da collection IndexedDB do TanStack DB, que esta collection não usa. */
const VERSIONS_STORE = "_versions";

type SyncParams<T extends object> = Parameters<SyncConfig<T, string>["sync"]>[0];

type Direct = { transaction: { mutations: PendingMutation[] } };

type Change<T> = { type: "insert" | "update" | "delete"; key: string; modified: T };

/** Uma mudança vinda de outra aba: as chaves que ela gravou. */
type CrossTabMessage = { tab: string; keys: string[] };

const requestOf = <R>(request: IDBRequest<R>) =>
  new Promise<R>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Os resumos como a tela os lê: `ready` depois da primeira leitura da store. */
export type SummarySnapshot<S> = { ready: boolean; rows: readonly S[] };

/**
 * Os resumos em memória, só para leitura: a collection do registro os atualiza a cada gravação, e a outra aba, pelo
 * canal. A assinatura (`useSyncExternalStore`) lê a store na primeira vez.
 */
export interface SummaryStore<S> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SummarySnapshot<S>;
  /** Lê a store, se ainda não leu. */
  preload: () => Promise<void>;
  readonly toArray: readonly S[];
  cleanup: () => Promise<void>;
}

/** As `utils` da collection do registro: as da store confirmada, mais `load`. */
export type SummarizedUtils<T extends object> = {
  /** Grava na store e no resumo, e confirma na memória (a store só aceita o que vem por aqui). */
  acceptMutations: (transaction: { mutations: PendingMutation[] }) => Promise<void>;
  /** A store inteira. Só o resync a lê assim (ADR 0047). */
  exportData: () => Promise<T[]>;
  /** Só os registros de `keys` que a store tem, lidos por chave. */
  readConfirmed: (keys: readonly string[]) => Promise<T[]>;
  /** Põe na memória os registros de `keys` que a store tem: o que um `update` otimista fora de uma consulta precisa. */
  load: (keys: readonly string[]) => Promise<void>;
};

/**
 * As duas collections de uma entidade com resumo: `records`, on-demand e por id, e `summaries`, eager. `summarize` vem
 * da feature e roda em cada gravação.
 */
export function createSummarizedCollections<T extends { id: string }, S extends { id: string }>({
  db,
  name,
  summaryName,
  summarize,
}: {
  db: IndexedDBInstance;
  name: string;
  summaryName: string;
  summarize: (record: T) => S;
}) {
  const tab = crypto.randomUUID();
  const channelName = `vistoria:${db.name}:${name}`;
  let recordSync: SyncParams<T> | undefined;
  /** Os resumos na memória, por id; `undefined` até a primeira leitura. */
  let summaryRows: Map<string, S> | undefined;
  let summarySnapshot: SummarySnapshot<S> = { ready: false, rows: [] };
  const summaryListeners = new Set<() => void>();
  /** As chaves que a collection do registro tem na memória (as outras não são atualizadas por outra aba). */
  const inMemory = new Set<string>();

  let tail: Promise<unknown> = Promise.resolve();
  function serial<R>(work: () => Promise<R>): Promise<R> {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  }

  function writeRecords(rows: readonly T[], deleted: readonly string[] = []) {
    const sync = recordSync;
    if (!sync || (rows.length === 0 && deleted.length === 0)) return;
    sync.begin();
    for (const row of rows) {
      sync.write({ type: "update", value: row });
      inMemory.add(row.id);
    }
    for (const key of deleted) {
      sync.write({ type: "delete", key });
      inMemory.delete(key);
    }
    sync.commit();
  }

  function publishSummaries() {
    summarySnapshot = {
      ready: summaryRows !== undefined,
      rows: [...(summaryRows?.values() ?? [])],
    };
    for (const listener of summaryListeners) listener();
  }

  function writeSummaries(rows: readonly S[], deleted: readonly string[] = []) {
    if (!summaryRows || (rows.length === 0 && deleted.length === 0)) return;
    for (const row of rows) summaryRows.set(row.id, row);
    for (const key of deleted) summaryRows.delete(key);
    publishSummaries();
  }

  function broadcast(keys: string[]) {
    try {
      const channel = new BroadcastChannel(channelName);
      channel.postMessage({ tab, keys } satisfies CrossTabMessage);
      channel.close();
    } catch {
      // Sem BroadcastChannel, a outra aba vê a mudança quando abrir de novo.
    }
  }

  /** Ouve as gravações de outra aba e relê as chaves delas. */
  function listen(reread: (keys: string[]) => Promise<void>) {
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
        if (event.data?.tab === tab || !Array.isArray(event.data?.keys)) return;
        void serial(() => reread(event.data.keys)).catch((error) =>
          console.warn(`[${name}] mudança de outra aba`, error),
        );
      };
    } catch {
      channel = undefined;
    }
    return () => channel?.close();
  }

  async function persist(changes: Change<T>[]) {
    await executeTransaction(db.db, [name, summaryName], "readwrite", (_, stores) => {
      for (const change of changes) {
        if (change.type === "delete") {
          stores[name]!.delete(change.key);
          stores[summaryName]!.delete(change.key);
        } else {
          stores[name]!.put(change.modified, change.key);
          stores[summaryName]!.put(summarize(change.modified), change.key);
        }
      }
    });
  }

  let records: Collection<T, string, SummarizedUtils<T>> | undefined;

  const acceptMutations = (transaction: { mutations: PendingMutation[] }) =>
    serial(async () => {
      const changes = transaction.mutations
        .filter((mutation) => mutation.collection === records)
        .map((mutation) => {
          const modified = mutation.modified as T;
          return { type: mutation.type, key: modified.id, modified };
        });
      if (changes.length === 0) return;
      await persist(changes);
      const kept = changes
        .filter((change) => change.type !== "delete")
        .map((change) => change.modified);
      const deleted = changes
        .filter((change) => change.type === "delete")
        .map((change) => change.key);
      writeRecords(kept, deleted);
      writeSummaries(kept.map(summarize), deleted);
      broadcast(changes.map((change) => change.key));
    });

  /** Lê da store as chaves pedidas e põe na memória; a que a store não tem fica de fora. */
  async function loadInto(keys: readonly string[]) {
    if (keys.length === 0) return;
    writeRecords(await readConfirmed<T>(db, name, keys));
  }

  const load = (keys: readonly string[]) => {
    if (!recordSync) records?.startSyncImmediate();
    return serial(() => loadInto(keys));
  };

  records = createCollection<T, string, SummarizedUtils<T>>({
    id: `summarized:${db.name}:${name}`,
    getKey: (record: T) => record.id,
    syncMode: "on-demand",
    sync: {
      rowUpdateMode: "full",
      sync: (params: SyncParams<T>) => {
        recordSync = params;
        const stop = listen(async (keys) => {
          const loaded = keys.filter((key) => inMemory.has(key));
          if (loaded.length === 0 || recordSync !== params) return;
          const rows = await readConfirmed<T>(db, name, loaded);
          const found = new Set(rows.map((row) => row.id));
          writeRecords(
            rows,
            loaded.filter((key) => !found.has(key)),
          );
        });
        params.markReady();
        return {
          loadSubset: (options: LoadSubsetOptions) => serial(() => loadInto(idsOf(name, options))),
          cleanup: () => {
            stop();
            if (recordSync === params) {
              recordSync = undefined;
              inMemory.clear();
            }
          },
        };
      },
    },
    // Uma mutação feita direto na collection, fora da outbox, grava como o pull.
    onInsert: ({ transaction }: Direct) => acceptMutations(transaction),
    onUpdate: ({ transaction }: Direct) => acceptMutations(transaction),
    onDelete: ({ transaction }: Direct) => acceptMutations(transaction),
    utils: {
      acceptMutations,
      exportData: () =>
        executeTransaction(db.db, name, "readonly", (_, stores) => getAll<T>(stores[name]!)),
      readConfirmed: (keys: readonly string[]) => readConfirmed<T>(db, name, keys),
      load,
    },
  } as never) as unknown as Collection<T, string, SummarizedUtils<T>>;

  let stopSummaries: (() => void) | undefined;
  let loadingSummaries: Promise<void> | undefined;
  /** Lê os resumos uma vez (com a migração antes) e passa a ouvir a outra aba. */
  const startSummaries = () => {
    loadingSummaries ??= (() => {
      stopSummaries = listen(async (keys) => {
        if (!summaryRows) return;
        const rows = await readConfirmed<S>(db, summaryName, keys);
        const found = new Set(rows.map((row) => row.id));
        writeSummaries(
          rows,
          keys.filter((key) => !found.has(key)),
        );
      });
      return serial(async () => {
        await migrate(db, name, summaryName, summarize);
        const rows = await executeTransaction(db.db, summaryName, "readonly", (_, stores) =>
          getAll<S>(stores[summaryName]!),
        );
        summaryRows = new Map(rows.map((row) => [row.id, row]));
        publishSummaries();
      });
    })();
    return loadingSummaries;
  };

  const summaries: SummaryStore<S> = {
    subscribe(listener) {
      summaryListeners.add(listener);
      void startSummaries().catch((error) => console.warn(`[${summaryName}] leitura`, error));
      return () => summaryListeners.delete(listener);
    },
    getSnapshot: () => summarySnapshot,
    preload: startSummaries,
    get toArray() {
      return summarySnapshot.rows;
    },
    async cleanup() {
      stopSummaries?.();
      stopSummaries = undefined;
      loadingSummaries = undefined;
      summaryRows = undefined;
      summarySnapshot = { ready: false, rows: [] };
    },
  };

  return { records, summaries };
}

/**
 * As chaves de uma consulta por id (`eq` ou `inArray` no `id`). A collection é on-demand para nunca abrir inteira:
 * qualquer outra consulta é erro de quem a escreveu, e quebra.
 */
function idsOf(name: string, options: LoadSubsetOptions): string[] {
  const comparisons = options.where ? extractSimpleComparisons(options.where) : [];
  const [comparison] = comparisons;
  const onId = comparisons.length === 1 && comparison?.field.at(-1) === "id";
  if (onId && comparison.operator === "eq" && typeof comparison.value === "string") {
    return [comparison.value];
  }
  if (onId && comparison.operator === "in" && Array.isArray(comparison.value)) {
    return comparison.value.filter((value): value is string => typeof value === "string");
  }
  throw new Error(`[${name}] a collection só carrega por id (eq ou inArray no id)`);
}

/**
 * A primeira abertura depois da store de resumos existir (banco na versão 6): a store tem registros e nenhum resumo.
 * Monta os resumos de uma vez, por cursor, e tira as entradas que a collection IndexedDB do TanStack DB deixou no
 * `_versions` para esta store. Depois, toda gravação leva os dois, e isto não acha mais nada a fazer.
 */
async function migrate<T extends { id: string }, S>(
  db: IndexedDBInstance,
  name: string,
  summaryName: string,
  summarize: (record: T) => S,
): Promise<void> {
  const needed = await executeTransaction(
    db.db,
    [name, summaryName],
    "readonly",
    async (_, stores) => {
      const [summaries, records] = await Promise.all([
        requestOf(stores[summaryName]!.count()),
        requestOf(stores[name]!.count()),
      ]);
      return summaries === 0 && records > 0;
    },
  );
  if (!needed) return;
  const scope = db.db.objectStoreNames.contains(VERSIONS_STORE)
    ? [name, summaryName, VERSIONS_STORE]
    : [name, summaryName];
  await executeTransaction(db.db, scope, "readwrite", async (_, stores) => {
    if ((await requestOf(stores[summaryName]!.count())) > 0) return;
    await new Promise<void>((resolve, reject) => {
      const cursor = stores[name]!.openCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) {
          resolve();
          return;
        }
        stores[summaryName]!.put(summarize(current.value as T), current.key);
        current.continue();
      };
    });
    const versions = stores[VERSIONS_STORE];
    if (!versions) return;
    await new Promise<void>((resolve, reject) => {
      const cursor = versions.openCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) {
          resolve();
          return;
        }
        if (Array.isArray(current.key) && current.key[0] === name) current.delete();
        current.continue();
      };
    });
  });
}
