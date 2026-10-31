import { type IndexedDBInstance, createIndexedDB } from "@tanstack/db";

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
