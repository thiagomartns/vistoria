// @vitest-environment node

import { describe, expect, it } from "vitest";

import { FIXED_TEMPLATE, newMoveInInspection } from "./inspections.factory";

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
