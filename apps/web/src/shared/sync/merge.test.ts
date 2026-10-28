import { describe, expect, it } from "vitest";

import { isOwnWrite, mergeFields, recordShape, sameValue } from "./merge";

// Um registro plano como o de client: corpo do PUT, id e version.
type Flat = {
  id: string;
  version: string | null;
  name: string;
  email: string | null;
  phone: string | null;
};

const base: Flat = { id: "c1", version: "AAA=", name: "Ana", email: "ana@x.com", phone: null };

describe("mergeFields", () => {
  it.each([
    ["nenhum mudou", "Ana", "Ana", "Ana", []],
    ["só o local mudou", "Ana Paula", "Ana", "Ana Paula", []],
    ["só o servidor mudou", "Ana", "Ana Lima", "Ana Lima", []],
    ["os dois mudaram para o mesmo valor", "Ana Paula", "Ana Paula", "Ana Paula", []],
    [
      "os dois mudaram para valores diferentes",
      "Ana Paula",
      "Ana Lima",
      "Ana Paula",
      [{ field: "name", base: "Ana", local: "Ana Paula", server: "Ana Lima" }],
    ],
  ] as const)("%s", (_, local, server, merged, collisions) => {
    const result = mergeFields(
      base,
      { ...base, name: local },
      { ...base, version: "BBB=", name: server },
    );
    expect(result.merged.name).toBe(merged);
    expect(result.collisions).toEqual(collisions);
  });

  it("decide cada campo por si e leva a version do servidor", () => {
    const local: Flat = { ...base, name: "Ana Paula", email: "ana@y.com", phone: "11 9999-0000" };
    const server: Flat = { ...base, version: "BBB=", email: "ana@z.com", phone: "11 9999-0000" };
    expect(mergeFields(base, local, server)).toEqual({
      merged: {
        id: "c1",
        version: "BBB=",
        name: "Ana Paula",
        email: "ana@y.com",
        phone: "11 9999-0000",
      },
      collisions: [{ field: "email", base: "ana@x.com", local: "ana@y.com", server: "ana@z.com" }],
    });
  });

  it("sem base, o que difere colide e o que é igual não", () => {
    const local: Flat = { ...base, name: "Ana Paula" };
    const server: Flat = { ...base, version: "BBB=" };
    expect(mergeFields(undefined, local, server).collisions).toEqual([
      { field: "name", base: undefined, local: "Ana Paula", server: "Ana" },
    ]);
  });

  it("null e campo ausente são o mesmo valor", () => {
    const { phone: _, ...withoutPhone } = base;
    const local = withoutPhone as Flat;
    const server: Flat = { ...base, version: "BBB=", name: "Ana Lima" };
    const result = mergeFields(base, local, server);
    expect(result.collisions).toEqual([]);
    expect(result.merged.name).toBe("Ana Lima");
  });

  it("valor composto é um campo só", () => {
    type WithRooms = { id: string; version: string | null; rooms: { id: string; name: string }[] };
    const shadow: WithRooms = { id: "v1", version: "AAA=", rooms: [{ id: "r1", name: "Sala" }] };
    const local: WithRooms = { ...shadow, rooms: [{ id: "r1", name: "Sala de estar" }] };
    const server: WithRooms = { ...shadow, version: "BBB=", rooms: [{ id: "r1", name: "Living" }] };
    expect(mergeFields(shadow, local, server).collisions.map((c) => c.field)).toEqual(["rooms"]);
  });

  it("registro sem version (ambiente, item) não ganha a chave", () => {
    type Item = { id: string; notes: string | null };
    const item: Item = { id: "t1", notes: null };
    const result = mergeFields(item, item, { ...item, notes: "Risco." });
    expect(result.merged).toEqual({ id: "t1", notes: "Risco." });
    expect("version" in result.merged).toBe(false);
  });
});

// O corpo enviado de uma vistoria e o current que o servidor devolveu para ele.
const sent = {
  id: "v1",
  version: "AAA=",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: "2026-10-26T13:00:00.123Z",
  generalNotes: null,
  rooms: [
    {
      id: "r1",
      name: "Sala",
      position: 0,
      notes: null,
      items: [{ id: "i1", name: "Piso", position: 0, condition: "good", notes: null }],
    },
  ],
};

const currentItem = {
  id: "i1",
  name: "Piso",
  position: 0,
  condition: "good",
  notes: null,
  referenceCondition: "new",
  referenceNotes: "riscado",
};

const currentRoom = { id: "r1", name: "Sala", position: 0, notes: null, items: [currentItem] };

const current = {
  id: "v1",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  referenceInspectionId: null,
  startedAt: "2026-10-26T13:00:00.1230000+00:00",
  completedAt: null,
  generalNotes: null,
  rooms: [currentRoom],
  version: "CCC=",
  createdAt: "2026-10-26T13:00:01+00:00",
  updatedAt: "2026-10-27T09:00:00+00:00",
};

describe("isOwnWrite", () => {
  it("corpo igual com version, datas do servidor e campos de referência diferentes é a própria escrita", () => {
    expect(isOwnWrite(current, sent)).toBe(true);
  });

  it("client: version e datas diferentes, corpo igual", () => {
    const client = {
      id: "c1",
      version: null,
      name: "Ana",
      document: null,
      email: "ana@x.com",
      phone: null,
    };
    const dto = {
      ...client,
      version: "BBB=",
      createdAt: "2026-10-26T13:00:00+00:00",
      updatedAt: "2026-10-27T09:00:00+00:00",
    };
    expect(isOwnWrite(dto, client)).toBe(true);
  });

  it("null no corpo e campo ausente no current são iguais", () => {
    const { generalNotes: _, ...withoutNotes } = current;
    expect(isOwnWrite(withoutNotes, sent)).toBe(true);
  });

  it.each([
    ["um campo da raiz", { ...current, generalNotes: "chave na portaria" }],
    ["a data de início em outro instante", { ...current, startedAt: "2026-10-26T13:00:01+00:00" }],
    [
      "a condição de um item",
      { ...current, rooms: [{ ...currentRoom, items: [{ ...currentItem, condition: "poor" }] }] },
    ],
    ["um ambiente a mais", { ...current, rooms: [currentRoom, currentRoom] }],
  ])("%s diferente não é", (_, other) => {
    expect(isOwnWrite(other, sent)).toBe(false);
  });

  it("sem current (deleted) não é", () => {
    expect(isOwnWrite(undefined, sent)).toBe(false);
  });
});

describe("sameValue", () => {
  it.each([
    [
      "mesmo instante em fusos diferentes",
      "2026-10-26T10:00:00-03:00",
      "2026-10-26T13:00:00.000Z",
      true,
    ],
    ["7 casas contra 3", "2026-10-26T13:00:00.1234567+00:00", "2026-10-26T13:00:00.123Z", true],
    ["instantes diferentes", "2026-10-26T13:00:00Z", "2026-10-26T13:00:01Z", false],
    ["data sem fuso compara pelo texto", "2026-10-26T13:00:00", "2026-10-26T13:00:00Z", false],
    ["texto que não é data", "Sala", "sala", false],
    ["null e ausente", null, undefined, true],
    ["null e texto vazio", null, "", false],
    ["arrays de tamanhos diferentes", ["a"], ["a", "b"], false],
    ["objetos com null e chave ausente", { a: 1, b: null }, { a: 1 }, true],
  ])("%s", (_, a, b, expected) => {
    expect(sameValue(a, b)).toBe(expected);
  });
});

describe("recordShape", () => {
  it("pega do DTO as chaves do registro e a version, e o que falta vira null", () => {
    const like: Flat = { id: "c1", version: "AAA=", name: "Ana", email: null, phone: null };
    const dto = {
      id: "c1",
      name: "Ana Lima",
      email: "ana@x.com",
      version: "BBB=",
      createdAt: "x",
      updatedAt: "y",
    };
    expect(recordShape(dto, like)).toEqual({
      id: "c1",
      version: "BBB=",
      name: "Ana Lima",
      email: "ana@x.com",
      phone: null,
    });
  });
});
