// @vitest-environment node

import { describe, expect, it } from "vitest";

import { newMoveInInspection } from "../services/inspections.factory";
import {
  NOTES_MAX,
  NOTES_TOO_LONG,
  formPathOf,
  formValuesOf,
  recordWith,
  roomOfError,
  roomStepSchema,
} from "./inspection.schemas";

describe("caminho do erro do servidor → campo do formulário", () => {
  it.each([
    ["rooms[2].items[4].condition", "rooms.2.items.4.condition"],
    ["rooms[0].items[1].notes", "rooms.0.items.1.notes"],
    ["Rooms[1].Items[0].Condition", "rooms.1.items.0.condition"],
  ])("%s → %s", (key, path) => {
    expect(formPathOf(key)).toBe(path);
  });

  it.each(["propertyId", "rooms[0].name", "rooms[0].items[1].name", "generalNotes"])(
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
  it("observação null vira '' e volta null quando fica em branco; o resto do registro fica", () => {
    const record = newMoveInInspection("p1");
    const values = formValuesOf(record);
    expect(values.rooms[0]?.items[0]).toEqual({ condition: null, notes: "" });

    values.rooms[0]!.items[0] = { condition: "good", notes: "Risco perto da porta" };
    values.rooms[0]!.items[1] = { condition: "fair", notes: "   " };
    const next = recordWith(record, values);

    expect(next.rooms[0]?.items[0]).toMatchObject({
      condition: "good",
      notes: "Risco perto da porta",
    });
    expect(next.rooms[0]?.items[1]).toMatchObject({ condition: "fair", notes: null });
    expect(next.rooms[0]?.items[0]?.id).toBe(record.rooms[0]?.items[0]?.id);
    expect(next.propertyId).toBe("p1");
  });

  it("sem valores para um item, o do registro fica", () => {
    const record = newMoveInInspection("p1");

    expect(recordWith(record, { rooms: [] })).toEqual(record);
  });
});

describe("roomStepSchema", () => {
  it("aceita item sem condição (avaliar é do concluir) e recusa observação longa com a mensagem do .NET", () => {
    expect(roomStepSchema.safeParse({ items: [{ condition: null, notes: "" }] }).success).toBe(
      true,
    );

    const result = roomStepSchema.safeParse({
      items: [{ condition: "good", notes: "x".repeat(NOTES_MAX + 1) }],
    });

    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["items", 0, "notes"], NOTES_TOO_LONG],
    ]);
    expect(NOTES_TOO_LONG).toBe("As observações podem ter até 1000 caracteres.");
  });
});
