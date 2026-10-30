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
  withUnsaved,
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

describe("withUnsaved: a versão do pull com a marcação que não chegou ao rascunho (ADR 0043)", () => {
  it("o que difere da base fica, pelo id do item, mesmo com a estrutura nova; o resto vem da versão nova", () => {
    const shown = newMoveInInspection("p1");
    const defaults = formValuesOf(shown);
    const values = formValuesOf(shown);
    values.rooms[0]!.items[1] = { condition: "poor", notes: "Trinca" };
    // A versão nova tem um item a mais antes do marcado e outro item mudado no outro aparelho.
    const room = shown.rooms[0]!;
    const added = { ...room.items[0]!, id: "novo", name: "Rodapé", condition: "good" as const };
    const changed = room.items.map((item, i) =>
      i === 0 ? { ...item, condition: "fair" as const } : item,
    );
    const next = {
      ...shown,
      rooms: [{ ...room, items: [added, ...changed] }, ...shown.rooms.slice(1)],
    };

    const merged = withUnsaved(next, shown, values, defaults);

    expect(merged.rooms[0]?.items[0]).toEqual({ condition: "good", notes: "" });
    expect(merged.rooms[0]?.items[1]).toEqual({ condition: "fair", notes: "" });
    expect(merged.rooms[0]?.items[2]).toEqual({ condition: "poor", notes: "Trinca" });
    expect(merged.rooms.length).toBe(shown.rooms.length);
  });

  it("sem marcação pendente: os valores da versão nova", () => {
    const shown = newMoveInInspection("p1");
    const next = { ...shown, rooms: shown.rooms.slice(1) };

    expect(withUnsaved(next, shown, formValuesOf(shown), formValuesOf(shown))).toEqual(
      formValuesOf(next),
    );
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
