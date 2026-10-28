// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import type { PropertyRecord } from "../models/property";
import {
  addressOf,
  clientOptionsOf,
  matchesFilters,
  matchesSearch,
  propertyCountByClient,
  propertyRowOf,
  propertyRows,
} from "./properties.view";

const property = (id: string, over: Partial<PropertyRecord> = {}): PropertyRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  clientId: "c1",
  street: "Rua das Flores",
  number: "120",
  complement: null,
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: null,
  ...over,
});

const rejected = (record: PropertyRecord, errors: Record<string, string[]> = {}): DraftRecord => ({
  id: record.id,
  entity: "property",
  data: record,
  status: "rejected",
  errors,
  updatedAt: "2026-10-22T12:00:00.000Z",
});

const clients = new Map([
  ["c1", "Imobiliária Horizonte"],
  ["c2", "Lar Imóveis"],
]);
const states = (entries: [string, RecordSyncState][] = []) => new Map(entries);

describe("addressOf", () => {
  it("rua, número e o complemento, se houver", () => {
    expect(addressOf(property("p1", { complement: "ap 32" }))).toBe("Rua das Flores, 120 · ap 32");
    expect(addressOf(property("p1"))).toBe("Rua das Flores, 120");
  });
});

describe("propertyRowOf", () => {
  it("nome do cliente, rótulo do tipo e 'Cidade/UF'", () => {
    expect(propertyRowOf(property("p1"), undefined, undefined, clients)).toMatchObject({
      address: "Rua das Flores, 120",
      clientName: "Imobiliária Horizonte",
      typeLabel: "Apartamento",
      place: "São Paulo/SP",
      sync: "sincronizado",
    });
  });

  it("cliente que não está no aparelho: sem nome", () => {
    expect(propertyRowOf(property("p1", { clientId: "c9" }), undefined, undefined, clients)?.clientName).toBeNull();
  });

  it("estado de sync: local, enviando; o rascunho recusado vence", () => {
    expect(propertyRowOf(property("p1"), undefined, "local")?.sync).toBe("local");
    expect(propertyRowOf(property("p1"), undefined, "enviando")?.sync).toBe("enviando");
    const draft = rejected(property("p1", { state: "XX" }));
    expect(propertyRowOf(property("p1"), draft, "local")).toMatchObject({ state: "XX", sync: "rejeitado" });
  });

  it("rascunho em conflito → conflito", () => {
    const draft: DraftRecord = {
      ...rejected(property("p1", { number: "9" })),
      status: "conflict",
      conflict: { current: property("p1"), collisions: [] },
    };
    expect(propertyRowOf(property("p1"), draft, undefined)).toMatchObject({ number: "9", sync: "conflito" });
  });
});

describe("propertyRows", () => {
  it("ordem de endereço (número como número), com a criação recusada pelo rascunho; rascunho de client não entra", () => {
    const rows = propertyRows(
      [property("p1", { number: "10" }), property("p2", { street: "Av. Brasil", number: "1500" })],
      [rejected(property("p3", { number: "2" })), { ...rejected(property("c3")), entity: "client" }],
      states(),
      clients,
    );
    expect(rows.map((row) => row.address)).toEqual([
      "Av. Brasil, 1500",
      "Rua das Flores, 2",
      "Rua das Flores, 10",
    ]);
    expect(rows[1]?.sync).toBe("rejeitado");
  });
});

describe("busca e filtros", () => {
  const [row] = propertyRows([property("p1", { complement: "ap 32" })], [], states(), clients);

  it("busca por endereço, bairro e cidade, sem acento nem caixa", () => {
    expect(matchesSearch(row!, "flores")).toBe(true);
    expect(matchesSearch(row!, "jardim")).toBe(true);
    expect(matchesSearch(row!, "sao paulo")).toBe(true);
    expect(matchesSearch(row!, "Horizonte")).toBe(false);
    expect(matchesSearch(row!, "  ")).toBe(true);
  });

  it("filtros por cliente e tipo; null é todos", () => {
    expect(matchesFilters(row!, { clientId: null, type: null })).toBe(true);
    expect(matchesFilters(row!, { clientId: "c1", type: "apartment" })).toBe(true);
    expect(matchesFilters(row!, { clientId: "c2", type: null })).toBe(false);
    expect(matchesFilters(row!, { clientId: null, type: "house" })).toBe(false);
  });
});

describe("clientes", () => {
  it("contagem de imóveis por cliente", () => {
    const counts = propertyCountByClient([property("p1"), property("p2"), property("p3", { clientId: "c2" })]);
    expect(Object.fromEntries(counts)).toEqual({ c1: 2, c2: 1 });
  });

  it("opções em ordem alfabética", () => {
    expect(
      clientOptionsOf([
        { id: "c2", name: "Lar Imóveis" },
        { id: "c1", name: "imobiliária Horizonte" },
      ]),
    ).toEqual([
      { value: "c1", label: "imobiliária Horizonte" },
      { value: "c2", label: "Lar Imóveis" },
    ]);
  });
});
