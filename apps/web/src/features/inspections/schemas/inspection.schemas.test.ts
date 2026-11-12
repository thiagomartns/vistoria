// @vitest-environment node

import { describe, expect, it } from "vitest";

import { DEFAULT_TEMPLATE, newMoveInInspection } from "../services/inspections.factory";
import {
  NOTES_MAX,
  NOTES_TOO_LONG,
  NO_CONDITION,
  NO_ITEMS,
  NO_ROOMS,
  completionErrors,
  formPathOf,
  formValuesOf,
  recordWith,
  roomOfError,
  ITEMS_MAX,
  ITEM_NAME_LENGTH,
  ITEM_NAME_REQUIRED,
  type InspectionFormValues,
  ROOMS_MAX,
  ROOM_NAME_LENGTH,
  ROOM_NAME_REQUIRED,
  TOO_MANY_ITEMS,
  TOO_MANY_ROOMS,
  roomStepSchema,
  structureErrors,
} from "./inspection.schemas";

describe("caminho do erro do servidor → campo do formulário", () => {
  it.each([
    ["rooms[2].items[4].condition", "rooms.2.items.4.condition"],
    ["rooms[0].items[1].notes", "rooms.0.items.1.notes"],
    ["Rooms[1].Items[0].Condition", "rooms.1.items.0.condition"],
    ["rooms[0].items[1].name", "rooms.0.items.1.name"],
    ["rooms[3].name", "rooms.3.name"],
  ])("%s → %s", (key, path) => {
    expect(formPathOf(key)).toBe(path);
  });

  it.each(["propertyId", "rooms[0].items", "rooms[0].items[1].id", "rooms", "generalNotes"])(
    "%s não está no formulário",
    (key) => {
      expect(formPathOf(key)).toBeUndefined();
    },
  );

  it("o ambiente de uma chave", () => {
    expect(roomOfError("rooms[3].items[0].condition")).toBe(3);
    expect(roomOfError("rooms[1].name")).toBe(1);
    expect(roomOfError("propertyId")).toBeUndefined();
  });
});

describe("valores do formulário ↔ registro", () => {
  it("ids e nomes no formulário; observação null vira '' e volta null quando fica em branco; o resto do registro fica", () => {
    const record = newMoveInInspection("p1", DEFAULT_TEMPLATE);
    const values = formValuesOf(record);
    const first = record.rooms[0]!.items[0]!;
    expect(values.rooms[0]).toMatchObject({ roomId: record.rooms[0]!.id, name: record.rooms[0]!.name });
    expect(values.rooms[0]?.items[0]).toEqual({
      itemId: first.id,
      name: first.name,
      condition: null,
      notes: "",
    });

    values.rooms[0]!.items[0] = { ...values.rooms[0]!.items[0]!, condition: "good", notes: "Risco perto da porta" };
    values.rooms[0]!.items[1] = { ...values.rooms[0]!.items[1]!, condition: "fair", notes: "   " };
    const next = recordWith(record, values);

    expect(next.rooms[0]?.items[0]).toMatchObject({
      condition: "good",
      notes: "Risco perto da porta",
    });
    expect(next.rooms[0]?.items[1]).toMatchObject({ condition: "fair", notes: null });
    expect(next.rooms[0]?.items[0]?.id).toBe(first.id);
    expect(next.propertyId).toBe("p1");
    expect(recordWith(record, formValuesOf(record))).toEqual(record);
  });

  it("a lista é a do formulário: incluído entra sem cópia, removido sai, a ordem vira a position e o nome perde os espaços", () => {
    const record = newMoveInInspection("p1", DEFAULT_TEMPLATE);
    record.rooms[0]!.notes = "Ambiente com infiltração.";
    const saida = {
      ...record,
      rooms: record.rooms.map((room) => ({
        ...room,
        items: room.items.map((item) => ({ ...item, referenceCondition: "good" as const, referenceNotes: null })),
      })),
    };
    const values = formValuesOf(saida);
    const [sala, cozinha] = values.rooms;
    // A cozinha vai para o topo; na sala, o segundo item sai, o primeiro vai para o fim e entra um item novo.
    const [piso, removido, ...resto] = sala!.items;
    values.rooms = [
      cozinha!,
      {
        ...sala!,
        name: "  Sala de estar ",
        items: [...resto, { itemId: "novo", name: " Ar-condicionado ", condition: "good", notes: "" }, piso!],
      },
      ...values.rooms.slice(2),
    ];

    const next = recordWith(saida, values);

    expect(next.rooms.map((room) => [room.id, room.position])).toEqual(
      values.rooms.map((room, position) => [room.roomId, position]),
    );
    const room = next.rooms[1]!;
    expect(room).toMatchObject({ id: sala!.roomId, name: "Sala de estar", notes: "Ambiente com infiltração." });
    expect(room.items.map((item) => [item.id, item.position])).toEqual(
      [...resto.map((item) => item.itemId), "novo", piso!.itemId].map((id, position) => [id, position]),
    );
    expect(room.items.some((item) => item.id === removido!.itemId)).toBe(false);
    const novo = room.items.find((item) => item.id === "novo");
    expect(novo).toEqual({
      id: "novo",
      name: "Ar-condicionado",
      position: resto.length,
      condition: "good",
      notes: null,
    });
    expect(room.items.at(-1)).toMatchObject({ id: piso!.itemId, referenceCondition: "good" });
  });

  it("ambiente novo nasce sem observação", () => {
    const record = newMoveInInspection("p1", DEFAULT_TEMPLATE);
    const values = formValuesOf(record);
    values.rooms.push({ roomId: "varanda", name: "Varanda", items: [] });

    expect(recordWith(record, values).rooms.at(-1)).toEqual({
      id: "varanda",
      name: "Varanda",
      position: record.rooms.length,
      notes: null,
      items: [],
    });
  });
});

describe("structureErrors: o que precisa valer para ir para a fila", () => {
  const values = (rooms: number, items: number): InspectionFormValues => ({
    rooms: Array.from({ length: rooms }, (_room, r) => ({
      roomId: `r${r}`,
      name: `Ambiente ${r + 1}`,
      items: Array.from({ length: items }, (_item, i) => ({
        itemId: `r${r}i${i}`,
        name: `Item ${i + 1}`,
        condition: null,
        notes: "",
      })),
    })),
  });

  it("os limites vêm do contrato: 40 ambientes, 60 itens por ambiente", () => {
    expect([ROOMS_MAX, ITEMS_MAX]).toEqual([40, 60]);
    expect(structureErrors(values(ROOMS_MAX, ITEMS_MAX))).toEqual({});
    expect(structureErrors(values(ROOMS_MAX + 1, 1))).toEqual({ rooms: TOO_MANY_ROOMS });
    expect(structureErrors(values(1, ITEMS_MAX + 1))).toEqual({ "rooms.0.items": TOO_MANY_ITEMS });
    expect(TOO_MANY_ROOMS).toBe("A vistoria pode ter até 40 ambientes.");
    expect(TOO_MANY_ITEMS).toBe("O ambiente pode ter até 60 itens.");
  });

  it("nome vazio (ou só espaços) e com mais de 60 caracteres, com as mensagens do .NET", () => {
    const form = values(2, 2);
    form.rooms[0]!.name = "   ";
    form.rooms[1]!.name = "x".repeat(61);
    form.rooms[1]!.items[0]!.name = "";
    form.rooms[1]!.items[1]!.name = "y".repeat(61);
    form.rooms[0]!.items[0]!.name = "z".repeat(60);

    expect(structureErrors(form)).toEqual({
      "rooms.0.name": ROOM_NAME_REQUIRED,
      "rooms.1.name": ROOM_NAME_LENGTH,
      "rooms.1.items.0.name": ITEM_NAME_REQUIRED,
      "rooms.1.items.1.name": ITEM_NAME_LENGTH,
    });
    expect([ROOM_NAME_REQUIRED, ROOM_NAME_LENGTH, ITEM_NAME_REQUIRED, ITEM_NAME_LENGTH]).toEqual([
      "Informe o nome do ambiente.",
      "O nome do ambiente precisa ter de 1 a 60 caracteres.",
      "Informe o nome do item.",
      "O nome do item precisa ter de 1 a 60 caracteres.",
    ]);
  });
});

describe("roomStepSchema", () => {
  it("aceita item sem condição (avaliar é do concluir) e recusa observação longa e nome vazio com a mensagem do .NET", () => {
    expect(
      roomStepSchema.safeParse({ items: [{ name: "Piso", condition: null, notes: "" }] }).success,
    ).toBe(true);

    const result = roomStepSchema.safeParse({
      items: [
        { name: "Piso", condition: "good", notes: "x".repeat(NOTES_MAX + 1) },
        { name: "", condition: null, notes: "" },
      ],
    });

    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["items", 0, "notes"], NOTES_TOO_LONG],
      [["items", 1, "name"], ITEM_NAME_REQUIRED],
    ]);
    expect(NOTES_TOO_LONG).toBe("As observações podem ter até 1000 caracteres.");
  });
});

describe("completeInspectionSchema (concluir, vision.md \"Regras de negócio\")", () => {
  it("tudo avaliado: nada falta", () => {
    const record = newMoveInInspection("p1", DEFAULT_TEMPLATE);
    const done = {
      rooms: record.rooms.map((room) => ({
        ...room,
        items: room.items.map((item) => ({ ...item, condition: "good" as const })),
      })),
    };

    expect(completionErrors(done)).toEqual({});
  });

  it("item sem condição e ambiente sem item: as chaves no caminho do backend, com as mensagens do .NET", () => {
    const record = newMoveInInspection("p1", DEFAULT_TEMPLATE);
    const rooms = record.rooms.map((room) => ({
      ...room,
      items: room.items.map((item) => ({ ...item, condition: "good" as const })),
    }));
    rooms[1]!.items[3] = { ...rooms[1]!.items[3]!, condition: null as never };
    rooms[2] = { ...rooms[2]!, items: [] };

    expect(completionErrors({ rooms })).toEqual({
      "rooms[1].items[3].condition": [NO_CONDITION],
      "rooms[2].items": [NO_ITEMS],
    });
  });

  it("sem ambiente", () => {
    expect(completionErrors({ rooms: [] })).toEqual({ rooms: [NO_ROOMS] });
  });
});
