// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { InspectionRecord } from "../models/inspection";
import { FIXED_TEMPLATE, newMoveInInspection, newMoveOutInspection } from "./inspections.factory";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("FIXED_TEMPLATE", () => {
  it("cinco ambientes comuns, com itens, nos limites do servidor (nomes de 1 a 60, até 40 ambientes e 60 itens)", () => {
    expect(FIXED_TEMPLATE.map((room) => room.name)).toEqual([
      "Sala",
      "Cozinha",
      "Banheiro",
      "Quarto",
      "Área de serviço",
    ]);
    expect(FIXED_TEMPLATE.length).toBeLessThanOrEqual(40);
    for (const room of FIXED_TEMPLATE) {
      expect(room.items.length).toBeGreaterThan(0);
      expect(room.items.length).toBeLessThanOrEqual(60);
      expect(new Set(room.items).size).toBe(room.items.length);
      for (const name of [room.name, ...room.items]) {
        expect(name.length).toBeGreaterThanOrEqual(1);
        expect(name.length).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe("newMoveInInspection", () => {
  const now = new Date("2026-10-26T13:00:00.000Z");

  it("entrada em andamento do imóvel, começada agora no aparelho, só no aparelho (sem version)", () => {
    const inspection = newMoveInInspection("p1", now);

    expect(inspection).toMatchObject({
      version: null,
      propertyId: "p1",
      kind: "moveIn",
      status: "inProgress",
      startedAt: "2026-10-26T13:00:00.000Z",
      generalNotes: null,
    });
  });

  it("copia o roteiro em ordem, com posições a partir de 0 e nenhum item avaliado", () => {
    const { rooms } = newMoveInInspection("p1", now);

    expect(rooms.map((room) => [room.name, room.position])).toEqual(
      FIXED_TEMPLATE.map((room, position) => [room.name, position]),
    );
    for (const [index, room] of rooms.entries()) {
      expect(room.notes).toBeNull();
      expect(room.items).toEqual(
        FIXED_TEMPLATE[index]!.items.map((name, position) => ({
          id: expect.any(String),
          name,
          position,
          condition: null,
          notes: null,
        })),
      );
    }
  });

  it("ids v7 do cliente, únicos na vistoria inteira e novos a cada vistoria", () => {
    const first = newMoveInInspection("p1", now);
    const second = newMoveInInspection("p1", now);
    const idsOf = (inspection: typeof first) => [
      inspection.id,
      ...inspection.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]),
    ];

    const ids = idsOf(first);
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expect(new Set(ids).size).toBe(ids.length);
    expect(idsOf(second).some((id) => ids.includes(id))).toBe(false);
  });
});

describe("newMoveOutInspection", () => {
  const now = new Date("2027-02-03T09:00:00.000Z");
  // Uma entrada concluída: um item sem observação, outro com.
  const moveIn: InspectionRecord = {
    id: "entrada",
    version: "AAAAAAAAB9M=",
    propertyId: "p1",
    kind: "moveIn",
    status: "completed",
    completedAt: "2026-10-26T18:00:00Z",
    startedAt: "2026-10-26T13:00:00Z",
    generalNotes: "Chaves com o porteiro.",
    rooms: [
      {
        id: "sala",
        name: "Sala",
        position: 0,
        notes: "Janela grande.",
        items: [
          { id: "piso", name: "Piso", position: 0, condition: "good", notes: null },
          { id: "paredes", name: "Paredes", position: 1, condition: "fair", notes: "Pintura nova." },
        ],
      },
      {
        id: "cozinha",
        name: "Cozinha",
        position: 1,
        notes: null,
        items: [{ id: "pia", name: "Pia", position: 0, condition: "new", notes: null }],
      },
    ],
  };

  it("saída em andamento no imóvel da entrada, apontando para ela, começada agora e só no aparelho", () => {
    const moveOut = newMoveOutInspection(moveIn, now);

    expect(moveOut).toMatchObject({
      version: null,
      propertyId: "p1",
      kind: "moveOut",
      status: "inProgress",
      startedAt: "2027-02-03T09:00:00.000Z",
      generalNotes: null,
      referenceInspectionId: "entrada",
    });
    expect(moveOut).not.toHaveProperty("completedAt");
  });

  it("ids v7 novos na raiz, nos ambientes e nos itens: nenhum é da entrada", () => {
    const moveOut = newMoveOutInspection(moveIn, now);
    const ids = [moveOut.id, ...moveOut.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)])];

    expect(ids.every((id) => UUID_V7.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("os mesmos ambientes e itens, com a condição e a observação da entrada na cópia e nada avaliado", () => {
    const moveOut = newMoveOutInspection(moveIn, now);

    expect(
      moveOut.rooms.map(({ name, position, notes, items }) => ({
        name,
        position,
        notes,
        items: items.map(({ id: _id, ...item }) => item),
      })),
    ).toEqual([
      {
        name: "Sala",
        position: 0,
        notes: null,
        items: [
          { name: "Piso", position: 0, condition: null, notes: null, referenceCondition: "good", referenceNotes: null },
          {
            name: "Paredes",
            position: 1,
            condition: null,
            notes: null,
            referenceCondition: "fair",
            referenceNotes: "Pintura nova.",
          },
        ],
      },
      {
        name: "Cozinha",
        position: 1,
        notes: null,
        items: [
          { name: "Pia", position: 0, condition: null, notes: null, referenceCondition: "new", referenceNotes: null },
        ],
      },
    ]);
  });
});
