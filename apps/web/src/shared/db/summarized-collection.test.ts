import {
  type IndexedDBInstance,
  createCollection,
  createIndexedDB,
  createLiveQueryCollection,
  eq,
  executeTransaction,
  getAll,
  inArray,
  indexedDBCollectionOptions,
} from "@tanstack/db";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSummarizedCollections } from "./summarized-collection";

// A entidade grande demais para abrir inteira (ADR 0048), contra um IndexedDB em memória: a collection do registro só
// carrega por id, e o resumo é gravado na mesma transação, então os dois nunca divergem.

type Row = { id: string; version: string; name: string; rooms: string[] };
type Summary = { id: string; version: string; name: string; rooms: number };

const summarize = (row: Row): Summary => ({
  id: row.id,
  version: row.version,
  name: row.name,
  rooms: row.rooms.length,
});

const ana: Row = { id: "v-ana", version: "AAAAAAAAAAE=", name: "Ana", rooms: ["Sala", "Cozinha"] };
const bia: Row = { id: "v-bia", version: "AAAAAAAAAAI=", name: "Bia", rooms: ["Quarto"] };
const caio: Row = { id: "v-caio", version: "AAAAAAAAAAM=", name: "Caio", rooms: [] };

const opened: IndexedDBInstance[] = [];
const factories = new Map<string, IDBFactory>();

async function openDb(name = `summarized-${crypto.randomUUID()}`) {
  const idbFactory = factories.get(name) ?? new IDBFactory();
  factories.set(name, idbFactory);
  const db = await createIndexedDB({
    name,
    version: 1,
    stores: ["records", "summaries"],
    idbFactory,
  });
  opened.push(db);
  return db;
}

const open = (db: IndexedDBInstance) =>
  createSummarizedCollections<Row, Summary>({
    db,
    name: "records",
    summaryName: "summaries",
    summarize,
  });

/** Sem as props virtuais do TanStack DB (`$synced` e afins). */
const plain = <T extends object>(rows: readonly T[]) =>
  rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("$"))),
  );

const storeOf = <T>(db: IndexedDBInstance, name: string) =>
  executeTransaction(db.db, name, "readonly", (_, stores) => getAll<T>(stores[name]!));

/** Grava como o pull: uma mutação da própria collection, sem transação. */
const accept = (
  records: ReturnType<typeof open>["records"],
  mutations: { type: "insert" | "update" | "delete"; modified: Row }[],
) =>
  records.utils.acceptMutations({
    mutations: mutations.map((mutation) => ({
      ...mutation,
      key: mutation.modified.id,
      collection: records,
    })),
  } as never);

const byId = (records: ReturnType<typeof open>["records"], id: string) =>
  createLiveQueryCollection((q) =>
    q
      .from({ row: records })
      .where(({ row }) => eq(row.id, id))
      .findOne(),
  );

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("collection com resumo (ADR 0048)", () => {
  it("abrir não carrega registro nenhum: o resumo vem inteiro, e a consulta por id carrega só aquele", async () => {
    const db = await openDb();
    const writer = open(db);
    await accept(writer.records, [
      { type: "insert", modified: ana },
      { type: "insert", modified: bia },
      { type: "insert", modified: caio },
    ]);

    const { records, summaries } = open(db);
    await summaries.preload();
    expect(plain(summaries.toArray)).toEqual(
      expect.arrayContaining([summarize(ana), summarize(bia), summarize(caio)]),
    );
    expect(summaries.toArray).toHaveLength(3);
    expect(records.size).toBe(0);

    const query = byId(records, bia.id);
    await query.preload();
    expect(plain(query.toArray)).toEqual([bia]);
    expect(plain(records.toArray)).toEqual([bia]);
    await query.cleanup();
  });

  it("carrega por inArray no id, e a consulta sem id quebra em vez de abrir tudo", async () => {
    const db = await openDb();
    const { records } = open(db);
    await accept(records, [
      { type: "insert", modified: ana },
      { type: "insert", modified: bia },
    ]);
    const { records: fresh } = open(db);

    const some = createLiveQueryCollection((q) =>
      q.from({ row: fresh }).where(({ row }) => inArray(row.id, [ana.id, "v-outra"])),
    );
    await some.preload();
    expect(plain(some.toArray)).toEqual([ana]);
    await some.cleanup();

    vi.spyOn(console, "error").mockImplementation(() => {});
    const all = createLiveQueryCollection((q) => q.from({ row: fresh }));
    await expect(all.preload()).rejects.toThrow(/só carrega por id/);
    await all.cleanup().catch(() => {});
  });

  it("gravar e excluir mexe nas duas stores juntas, e a memória acompanha", async () => {
    const db = await openDb();
    const { records, summaries } = open(db);
    await summaries.preload();
    const query = byId(records, ana.id);
    await query.preload();

    await accept(records, [
      { type: "insert", modified: ana },
      { type: "insert", modified: bia },
    ]);
    const renamed = { ...ana, version: "AAAAAAAAAAQ=", rooms: ["Sala"] };
    await accept(records, [
      { type: "update", modified: renamed },
      { type: "delete", modified: bia },
    ]);

    expect(await storeOf(db, "records")).toEqual([renamed]);
    expect(await storeOf(db, "summaries")).toEqual([summarize(renamed)]);
    expect(plain(summaries.toArray)).toEqual([summarize(renamed)]);
    expect(plain(query.toArray)).toEqual([renamed]);
    expect(await records.utils.readConfirmed([ana.id, bia.id])).toEqual([renamed]);
    expect(await records.utils.exportData()).toEqual([renamed]);
    await query.cleanup();
  });

  it("load põe na memória o que a store tem, para um update otimista fora de uma consulta", async () => {
    const db = await openDb();
    await accept(open(db).records, [{ type: "insert", modified: ana }]);
    const { records } = open(db);

    expect(records.has(ana.id)).toBe(false);
    await records.utils.load([ana.id, "v-outra"]);
    expect(plain([records.get(ana.id)!])).toEqual([ana]);
    expect(records.has("v-outra")).toBe(false);
  });

  it("a primeira abertura com registros e sem resumo monta os resumos uma vez", async () => {
    const name = `summarized-${crypto.randomUUID()}`;
    const before = await openDb(name);
    // Como a collection IndexedDB do TanStack DB gravava antes da store de resumo existir.
    const legacy = createCollection(
      indexedDBCollectionOptions<Row, string>({
        db: before,
        name: "records",
        getKey: (row) => row.id,
      }),
    );
    await legacy.preload();
    await legacy.insert(ana).isPersisted.promise;
    await legacy.insert(bia).isPersisted.promise;
    await legacy.cleanup();

    const { summaries } = open(before);
    await summaries.preload();
    expect(summaries.toArray).toHaveLength(2);
    expect(await storeOf(before, "summaries")).toEqual(
      expect.arrayContaining([summarize(ana), summarize(bia)]),
    );
    const versions = await storeOf<unknown>(before, "_versions");
    expect(versions).toEqual([]);
  });

  it("a outra aba vê a gravação: o resumo sempre, e o registro só se o tiver na memória", async () => {
    const name = `summarized-${crypto.randomUUID()}`;
    const first = open(await openDb(name));
    const second = open(await openDb(name));
    await second.summaries.preload();
    await accept(first.records, [{ type: "insert", modified: ana }]);
    const query = byId(second.records, ana.id);
    await query.preload();

    const renamed = { ...ana, version: "AAAAAAAAAAU=", name: "Ana Maria" };
    await accept(first.records, [
      { type: "update", modified: renamed },
      { type: "insert", modified: bia },
    ]);

    await vi.waitFor(() =>
      expect(plain(second.summaries.toArray)).toEqual(
        expect.arrayContaining([summarize(renamed), summarize(bia)]),
      ),
    );
    await vi.waitFor(() => expect(plain(query.toArray)).toEqual([renamed]));
    expect(second.records.has(bia.id)).toBe(false);
    await query.cleanup();
  });
});
