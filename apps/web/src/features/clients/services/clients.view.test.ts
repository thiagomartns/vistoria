// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import type { ClientRecord } from "../models/client";
import { clientRowOf, clientRows, matchesSearch } from "./clients.view";

const client = (name: string, over: Partial<ClientRecord> = {}): ClientRecord => ({
  id: name.toLowerCase().replaceAll(" ", "-"),
  version: "AAAAAAAAB9M=",
  name,
  document: null,
  email: null,
  phone: null,
  ...over,
});

const rejected = (record: ClientRecord, errors: Record<string, string[]> = {}): DraftRecord => ({
  id: record.id,
  entity: "client",
  data: record,
  status: "rejected",
  errors,
  updatedAt: "2026-10-22T12:00:00.000Z",
});

const states = (entries: [string, RecordSyncState][] = []) => new Map(entries);

describe("estado de sync de um client", () => {
  const maria = client("Maria Souza", { version: null });

  it("criado offline, com a transação na fila → local", () => {
    expect(clientRowOf(maria, undefined, "local")?.sync).toBe("local");
  });

  it("transação no ar → enviando", () => {
    expect(clientRowOf(maria, undefined, "enviando")?.sync).toBe("enviando");
  });

  it("outbox sem transação dele → sincronizado", () => {
    expect(clientRowOf(maria, undefined, undefined)?.sync).toBe("sincronizado");
  });

  it("rascunho recusado vence, com os dados que o servidor recusou", () => {
    const row = clientRowOf(maria, rejected({ ...maria, name: "M" }), undefined);

    expect(row).toMatchObject({ name: "M", sync: "rejeitado" });
  });

  it("rascunho em conflito → conflito, com os dados enviados", () => {
    const draft: DraftRecord = { ...rejected({ ...maria, name: "M" }), status: "conflict", conflict: { current: maria } };

    expect(clientRowOf(maria, draft, "local")).toMatchObject({ name: "M", sync: "conflito" });
  });

  it("sem client nem rascunho, nada", () => {
    expect(clientRowOf(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe("clientRows", () => {
  const alfa = client("Imobiliária Alfa", { document: "11222333000181", email: "contato@alfa.com" });
  const beta = client("beta Imóveis", { email: "vistorias@beta.com.br" });
  const lar = client("Lar Imóveis", { document: "52998224725" });

  it("ordem alfabética, sem caixa nem acento", () => {
    const rows = clientRows([lar, beta, alfa], [], states());

    expect(rows.map((row) => row.name)).toEqual(["beta Imóveis", "Imobiliária Alfa", "Lar Imóveis"]);
  });

  it("criação recusada: o registro some da collection (otimista desfeito), mas a linha fica pelo rascunho", () => {
    const gama = client("Gama", { version: null });

    const rows = clientRows([alfa], [rejected(gama)], states());

    expect(rows.map((row) => [row.name, row.sync])).toEqual([
      ["Gama", "rejeitado"],
      ["Imobiliária Alfa", "sincronizado"],
    ]);
  });

  it("rascunho de outra entidade não entra", () => {
    const other = { ...rejected(client("Rua das Flores")), entity: "property" };

    expect(clientRows([], [other], states())).toEqual([]);
  });

  it("estado por id: local e enviando", () => {
    const rows = clientRows([alfa, beta], [], states([[alfa.id, "local"], [beta.id, "enviando"]]));

    expect(Object.fromEntries(rows.map((row) => [row.name, row.sync]))).toEqual({
      "Imobiliária Alfa": "local",
      "beta Imóveis": "enviando",
    });
  });

  it.each([
    ["nome sem acento", "imobiliaria", ["Imobiliária Alfa"]],
    ["documento com máscara", "529.982", ["Lar Imóveis"]],
    ["documento sem máscara", "112223", ["Imobiliária Alfa"]],
    ["e-mail", "beta.com", ["beta Imóveis"]],
    ["vazio", "  ", ["beta Imóveis", "Imobiliária Alfa", "Lar Imóveis"]],
    ["sem resultado", "zzz", []],
  ])("busca por %s", (_, search, names) => {
    const rows = clientRows([alfa, beta, lar], [], states()).filter((row) =>
      matchesSearch(row, search),
    );

    expect(rows.map((row) => row.name)).toEqual(names);
  });
});
