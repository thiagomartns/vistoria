import { type IndexedDBInstance, createIndexedDB } from "@tanstack/db";

// Banco local do aparelho, uma store por collection. Nome fixo no spike 1a; separar por `user.id`,
// versão de schema e wipe são do M4 (frontend.md, "Dados no aparelho").

export const LOCAL_STORES = ["clients"] as const;

let opening: Promise<IndexedDBInstance> | undefined;

export function openLocalDb(): Promise<IndexedDBInstance> {
  opening ??= createIndexedDB({ name: "vistoria", version: 1, stores: LOCAL_STORES });
  return opening;
}
