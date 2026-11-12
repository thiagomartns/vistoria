// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { TemplateRoom } from "@/features/templates/models/template";

import type { InspectionRecord } from "../models/inspection";
import { DEFAULT_TEMPLATE, newMoveInInspection, newMoveOutInspection } from "./inspections.factory";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("DEFAULT_TEMPLATE", () => {
  it("cinco ambientes comuns, com itens, nos limites do servidor (nomes de 1 a 60, até 40 ambientes e 60 itens)", () => {
    expect(DEFAULT_TEMPLATE.map((room) => room.name)).toEqual([
      "Sala",
      "Cozinha",
      "Banheiro",
      "Quarto",
      "Área de serviço",
    ]);
    expect(DEFAULT_TEMPLATE.length).toBeLessThanOrEqual(40);
    for (const room of DEFAULT_TEMPLATE) {
      const names = room.items.map((item) => item.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names.length).toBeLessThanOrEqual(60);
      expect(new Set(names).size).toBe(names.length);
      for (const name of [room.name, ...names]) {
        expect(name.length).toBeGreaterThanOrEqual(1);
        expect(name.length).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe("newMoveInInspection", () => {
  const now = new Date("2026-10-26T13:00:00.000Z");
  // Os ambientes de um roteiro "Casa" do aparelho, como o banco local guarda: ids do roteiro, na ordem da position.
  const casa = (): TemplateRoom[] => [
    {
      id: "r-quintal",
      name: "Quintal",
      position: 0,
      items: [
        { id: "i-piso", name: "Piso", position: 0 },
        { id: "i-muro", name: "Muro", position: 1 },
        { id: "i-portao", name: "Portão", position: 2 },
      ],
    },
    {
      id: "r-garagem",
      name: "Garagem",
      position: 1,
      items: [{ id: "i-portao-2", name: "Portão", position: 0 }],
    },
    { id: "r-varanda", name: "Varanda", position: 2, items: [] },
  ];
  const idsOf = (inspection: InspectionRecord) => [
    inspection.id,
    ...inspection.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]),
  ];

  it("entrada em andamento do imóvel, começada agora no aparelho, só no aparelho (sem version)", () => {
    const inspection = newMoveInInspection("p1", casa(), now);

    expect(inspection).toMatchObject({
      version: null,
      propertyId: "p1",
      kind: "moveIn",
      status: "inProgress",
      startedAt: "2026-10-26T13:00:00.000Z",
      generalNotes: null,
    });
    expect(inspection).not.toHaveProperty("referenceInspectionId");
  });

  it("copia o roteiro escolhido em ordem, com posições a partir de 0 e nenhum item avaliado", () => {
    const { rooms } = newMoveInInspection("p1", casa(), now);

    expect(
      rooms.map(({ id: _id, items, ...room }) => ({
        ...room,
        items: items.map(({ id: _i, ...item }) => item),
      })),
    ).toEqual([
      {
        name: "Quintal",
        position: 0,
        notes: null,
        items: [
          { name: "Piso", position: 0, condition: null, notes: null },
          { name: "Muro", position: 1, condition: null, notes: null },
          { name: "Portão", position: 2, condition: null, notes: null },
        ],
      },
      {
        name: "Garagem",
        position: 1,
        notes: null,
        items: [{ name: "Portão", position: 0, condition: null, notes: null }],
      },
      { name: "Varanda", position: 2, notes: null, items: [] },
    ]);
  });

  it("ids v7 novos: nenhum é do roteiro, únicos na vistoria inteira e novos a cada vistoria", () => {
    const template = casa();
    const first = newMoveInInspection("p1", template, now);
    const second = newMoveInInspection("p1", template, now);
    const templateIds = template.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]);

    const ids = idsOf(first);
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => templateIds.includes(id))).toBe(false);
    expect(idsOf(second).some((id) => ids.includes(id))).toBe(false);
  });

  it("editar o roteiro depois não muda a vistoria: renomear, tirar, acrescentar e reordenar ambientes e itens", () => {
    const template = casa();
    const inspection = newMoveInInspection("p1", template, now);
    const before = structuredClone(inspection);

    template[0]!.name = "Jardim";
    template[0]!.items[0]!.name = "Grama";
    template[0]!.items.pop();
    template[1]!.items.push({ id: "i-luz", name: "Iluminação", position: 1 });
    template.reverse();
    template.push({ id: "r-nova", name: "Edícula", position: 3, items: [] });

    expect(inspection).toEqual(before);
  });

  it("o roteiro padrão, num aparelho sem roteiro: os cinco ambientes dele, com os itens", () => {
    const { rooms } = newMoveInInspection("p1", DEFAULT_TEMPLATE, now);

    expect(rooms.map((room) => [room.name, room.items.map((item) => item.name)])).toEqual(
      DEFAULT_TEMPLATE.map((room) => [room.name, room.items.map((item) => item.name)]),
    );
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
