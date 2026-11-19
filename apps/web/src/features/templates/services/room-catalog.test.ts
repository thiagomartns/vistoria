// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ROOM_CATALOG, catalogRoom } from "../models/room-catalog";
import { ITEMS_MAX, ROOMS_MAX, templateFormSchema } from "../schemas/template.schemas";
import { catalogRoomView, catalogRoomViews, roomsFromCatalog } from "./room-catalog";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const itemNames = (name: string) => catalogRoom(name).items.map((item) => item.name);

describe("ROOM_CATALOG", () => {
  it("ambientes comuns com nomes únicos, todos nos limites do contrato (nomes de 1 a 60, até 60 itens)", () => {
    const names = ROOM_CATALOG.map((room) => room.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Sala",
        "Cozinha",
        "Quarto",
        "Banheiro",
        "Área de serviço",
        "Varanda",
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(ROOM_CATALOG.length).toBeLessThanOrEqual(ROOMS_MAX);
    for (const room of ROOM_CATALOG) {
      const items = room.items.map((item) => item.name);
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(ITEMS_MAX);
      expect(new Set(items).size).toBe(items.length);
      for (const name of [room.name, ...items]) {
        expect(name.length).toBeGreaterThanOrEqual(1);
        expect(name.length).toBeLessThanOrEqual(60);
      }
    }
  });

  it("um nome fora do catálogo é erro", () => {
    expect(() => catalogRoom("Sótão")).toThrow("Sótão");
  });
});

describe("catalogRoomView", () => {
  it('o nome e "N itens", com os três primeiros e quantos mais', () => {
    expect(catalogRoomViews()[0]).toEqual({
      name: "Sala",
      detail: "7 itens · Piso, Paredes, Teto e mais 4",
    });
    expect(
      catalogRoomView({ name: "X", items: [{ name: "A" }, { name: "B" }, { name: "C" }] }),
    ).toEqual({
      name: "X",
      detail: "3 itens · A, B e C",
    });
    expect(catalogRoomView({ name: "X", items: [{ name: "A" }] }).detail).toBe("1 item · A");
  });
});

describe("roomsFromCatalog", () => {
  it('Sala e dois Quartos: três ambientes com os itens do catálogo, ids v7 novos e "Quarto 1" e "Quarto 2"', () => {
    const rooms = roomsFromCatalog(
      [
        { name: "Quarto", count: 2 },
        { name: "Sala", count: 1 },
      ],
      [],
    );

    expect(rooms.map((room) => room.name)).toEqual(["Sala", "Quarto 1", "Quarto 2"]);
    expect(rooms.map((room) => room.items.map((item) => item.name))).toEqual([
      itemNames("Sala"),
      itemNames("Quarto"),
      itemNames("Quarto"),
    ]);
    const ids = rooms.flatMap((room) => [room.roomId, ...room.items.map((item) => item.itemId)]);
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("os ambientes saem válidos para o formulário (os mesmos limites do PUT)", () => {
    const rooms = roomsFromCatalog(
      ROOM_CATALOG.map((room) => ({ name: room.name, count: 1 })),
      [],
    );
    expect(templateFormSchema.safeParse({ name: "Prontos", rooms }).success).toBe(true);
  });

  it('com "Quarto" ou "Quarto N" no roteiro, a contagem continua e os de lá não mudam', () => {
    expect(
      roomsFromCatalog([{ name: "Quarto", count: 1 }], ["Sala", "Quarto"]).map((room) => room.name),
    ).toEqual(["Quarto 2"]);
    expect(
      roomsFromCatalog(
        [{ name: "Quarto", count: 2 }],
        ["quarto 1", " Quarto 3 ", "Quarto de hóspedes"],
      ).map((room) => room.name),
    ).toEqual(["Quarto 4", "Quarto 5"]);
    expect(
      roomsFromCatalog([{ name: "Quarto", count: 1 }], ["Quarto de hóspedes"]).map(
        (room) => room.name,
      ),
    ).toEqual(["Quarto"]);
  });

  it("escolha vazia não monta nada; o que passa do que cabe fica de fora", () => {
    expect(roomsFromCatalog([{ name: "Sala", count: 0 }], [])).toEqual([]);
    expect(
      roomsFromCatalog(
        [
          { name: "Sala", count: 1 },
          { name: "Quarto", count: 3 },
        ],
        [],
        2,
      ).map((room) => room.name),
    ).toEqual(["Sala", "Quarto 1"]);
  });
});
