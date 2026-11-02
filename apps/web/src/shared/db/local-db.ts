import {
  type CollectionConfig,
  type IndexedDBCollectionUtils,
  type IndexedDBInstance,
  createIndexedDB,
  executeTransaction,
  getByKey,
  indexedDBCollectionOptions,
} from "@tanstack/db";

// Banco local do aparelho, um por usuário (`vistoria-<user.id>`, frontend.md "Dados no aparelho"), com uma store por
// collection: as das entidades, os rascunhos e, do pull, os cursores e as marcas dos registros pulados. Uma store nova só
// sobe a versão (o IndexedDB cria as que faltam no upgrade). Apagar o banco ao sair ou trocar de usuário é `wipe.ts`.

export const LOCAL_STORES = [
  "clients",
  "properties",
  "inspections",
  "drafts",
  "cursors",
  "skipped",
] as const;
const LOCAL_DB_VERSION = 5;

/** Nome do banco local de um usuário. */
export const localDbName = (ownerId: string) => `vistoria-${ownerId}`;

const opening = new Map<string, Promise<IndexedDBInstance>>();

export function openLocalDb(ownerId: string): Promise<IndexedDBInstance> {
  let db = opening.get(ownerId);
  if (!db) {
    db = createIndexedDB({ name: localDbName(ownerId), version: LOCAL_DB_VERSION, stores: LOCAL_STORES });
    opening.set(ownerId, db);
  }
  return db;
}

/** Fecha o banco de um usuário (troca de usuário na mesma página). */
export async function closeLocalDb(ownerId: string): Promise<void> {
  const db = opening.get(ownerId);
  opening.delete(ownerId);
  (await db)?.close();
}

/**
 * Lê da store `name` só as chaves pedidas, numa transação: o que a collection IndexedDB de mesmo nome confirmou. Ela
 * grava cada registro pela chave (`getKey`), e o `exportData` dela lê a store inteira, o que custa segundos com
 * milhares de vistorias (spike 2, ADR 0047).
 */
export function readConfirmed<T>(
  db: IndexedDBInstance,
  name: string,
  keys: readonly string[],
): Promise<T[]> {
  return executeTransaction(db.db, name, "readonly", async (_, stores) => {
    const store = stores[name]!;
    const rows = await Promise.all(keys.map((key) => getByKey<T>(store, key)));
    return rows.filter((row) => row !== undefined);
  });
}

/**
 * As opções da collection IndexedDB de uma entidade sincronizada (clients, properties, inspections): a store `name`,
 * pelo `id`, com o `readConfirmed` nas `utils`, ao lado do `exportData` e do `acceptMutations` da própria collection.
 */
export function syncedCollectionOptions<T extends { id: string }>(
  db: IndexedDBInstance,
  name: string,
): CollectionConfig<T, string, never, SyncedUtils<T>> & { schema?: never; utils: SyncedUtils<T> } {
  const options = indexedDBCollectionOptions<T, string>({ db, name, getKey: (record) => record.id });
  // As opções carregam uma fábrica em propriedade não enumerável: as `utils` mudam no lugar, sem copiar as opções.
  Object.assign(options.utils, {
    readConfirmed: (keys: readonly string[]) => readConfirmed<T>(db, name, keys),
  });
  return options as unknown as ReturnType<typeof syncedCollectionOptions<T>>;
}

/** As `utils` da collection IndexedDB, mais a leitura por chave. */
export type SyncedUtils<T extends object> = IndexedDBCollectionUtils<T> & {
  readConfirmed: (keys: readonly string[]) => Promise<T[]>;
};
