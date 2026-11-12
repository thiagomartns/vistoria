import { describe, expect, it } from "vitest";

import type { DraftRecord } from "@/shared/sync/drafts";
import { flatConflictOf } from "@/shared/sync/flat-conflict";

import type { TemplateRecord } from "../models/template";
import {
  matchesSearch,
  roomsSummary,
  templateConflictGroups,
  templateRowOf,
  templateRows,
} from "./templates.view";

const item = (id: string, name: string, position: number) => ({ id, name, position });

const apartamento: TemplateRecord = {
  id: "t1",
  version: "AAAAAAAAB9M=",
  name: "Apartamento",
  rooms: [
    { id: "r2", name: "Cozinha", position: 1, items: [item("i3", "Piso", 0)] },
    { id: "r1", name: "Sala", position: 0, items: [item("i2", "Teto", 1), item("i1", "Piso", 0)] },
  ],
};
const casa: TemplateRecord = { id: "t2", version: "AAAAAAAAB9N=", name: "casa térrea", rooms: [] };

describe("templateRowOf", () => {
  it("contagens e ambientes e itens na ordem da position", () => {
    const row = templateRowOf(apartamento, undefined, undefined);

    expect(row).toMatchObject({
      name: "Apartamento",
      roomCount: 2,
      itemCount: 3,
      sync: "sincronizado",
    });
    expect(row?.rooms.map((room) => room.name)).toEqual(["Sala", "Cozinha"]);
    expect(row?.rooms[0]?.items.map((entry) => entry.name)).toEqual(["Piso", "Teto"]);
  });

  it("o rascunho recusado vence, com o estado dele", () => {
    const draft: DraftRecord = {
      id: "t1",
      entity: "template",
      data: { ...apartamento, name: "x".repeat(61) },
      status: "rejected",
      errors: { name: ["O nome precisa ter de 1 a 60 caracteres."] },
      updatedAt: "2026-11-12T12:00:00.000Z",
    };

    expect(templateRowOf(apartamento, draft, "local")).toMatchObject({
      name: "x".repeat(61),
      sync: "rejeitado",
    });
  });
});

describe("templateRows", () => {
  it("em ordem de nome, com o estado de sync e a criação recusada que só existe no rascunho", () => {
    const draft: DraftRecord = {
      id: "t3",
      entity: "template",
      data: { id: "t3", version: null, name: "Bangalô", rooms: [] },
      status: "rejected",
      errors: { "rooms[0].name": ["Informe o nome do ambiente."] },
      updatedAt: "2026-11-12T12:00:00.000Z",
    };
    const otherEntity: DraftRecord = { ...draft, id: "c1", entity: "client" };

    const rows = templateRows(
      [apartamento, casa],
      [draft, otherEntity],
      new Map([["t2", "enviando"]]),
    );

    expect(rows.map((row) => [row.name, row.sync])).toEqual([
      ["Apartamento", "sincronizado"],
      ["Bangalô", "rejeitado"],
      ["casa térrea", "enviando"],
    ]);
  });
});

describe("matchesSearch", () => {
  it("pelo nome, sem acento nem caixa", () => {
    const row = templateRowOf(casa, undefined, undefined)!;
    expect(matchesSearch(row, "TERREA")).toBe(true);
    expect(matchesSearch(row, " ")).toBe(true);
    expect(matchesSearch(row, "sala")).toBe(false);
  });
});

describe("templateConflictGroups", () => {
  const conflictOf = (local: TemplateRecord, current: TemplateRecord) =>
    flatConflictOf<TemplateRecord>({
      id: "t1",
      entity: "template",
      data: local,
      status: "conflict",
      errors: {},
      conflict: { current, base: apartamento, collisions: [] },
      updatedAt: "2026-11-12T12:00:00.000Z",
    })!;

  it("Nome e Ambientes num grupo Roteiro; os ambientes resumidos por lado e o Antes em contagens", () => {
    const mine: TemplateRecord = {
      ...apartamento,
      name: "Apartamento padrão",
      rooms: [...apartamento.rooms, { id: "r3", name: "Varanda", position: 2, items: [] }],
    };
    const theirs: TemplateRecord = {
      ...apartamento,
      version: "AAAAAAAAB9U=",
      name: "Apartamento 2 quartos",
      rooms: [{ id: "r1", name: "Sala ampla", position: 0, items: [item("i1", "Piso", 0)] }],
    };

    expect(templateConflictGroups(conflictOf(mine, theirs))).toEqual([
      {
        id: "",
        title: "Roteiro",
        fields: [
          {
            key: "name",
            label: "Nome",
            before: "Antes: Apartamento",
            mine: "Apartamento padrão",
            theirs: "Apartamento 2 quartos",
          },
          {
            key: "rooms",
            label: "Ambientes",
            before: "Antes: 2 ambientes, 3 itens",
            mine: "Sala (2 itens), Cozinha (1 item), Varanda (0 itens)",
            theirs: "Sala ampla (1 item)",
          },
        ],
      },
    ]);
  });

  it("os ambientes que só um lado mudou não são perguntados", () => {
    const mine: TemplateRecord = { ...apartamento, name: "Apartamento padrão" };
    const theirs: TemplateRecord = { ...apartamento, version: "AAAAAAAAB9U=", rooms: [] };

    const groups = templateConflictGroups(conflictOf(mine, theirs));

    expect(groups).toEqual([]);
  });

  it("resumo de uma lista vazia", () => {
    expect(roomsSummary([])).toBe("");
  });
});
