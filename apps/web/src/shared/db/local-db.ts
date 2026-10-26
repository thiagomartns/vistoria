import { type IndexedDBInstance, createIndexedDB } from "@tanstack/db";

// Banco local do aparelho, um por usuário (`vistoria-<user.id>`, frontend.md "Dados no aparelho"), com uma store por
// collection. Versão de schema e wipe são do M4; até lá, uma store nova só sobe a versão (o IndexedDB cria as que
// faltam no upgrade).

export const LOCAL_STORES = ["clients", "properties", "inspections", "drafts"] as const;
const LOCAL_DB_VERSION = 4;

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
