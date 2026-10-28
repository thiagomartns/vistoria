// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { InspectionRecord, ItemRecord, RoomRecord } from "../models/inspection";
import { mergeInspection } from "./inspections.merge";

const item = (id: string, name: string, position: number): ItemRecord => ({
  id,
  name,
  position,
  condition: null,
  notes: null,
});

// A serverShadow: dois ambientes com dois itens cada.
const base: InspectionRecord = {
  id: "v1",
  version: "AAA=",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: "2026-10-26T13:00:00.000Z",
  generalNotes: null,
  rooms: [
    {
      id: "r1",
      name: "Sala",
      position: 0,
      notes: null,
      items: [item("t1", "Piso", 0), item("t2", "Parede", 1)],
    },
    {
      id: "r2",
      name: "Cozinha",
      position: 1,
      notes: null,
      items: [item("t3", "Pia", 0), item("t4", "Armário", 1)],
    },
  ],
};

/** Uma cópia da base com a mudança de um lado; o servidor sobe a versão. */
const local = (change: (draft: InspectionRecord) => void = () => {}) => {
  const draft = structuredClone(base);
  change(draft);
  return draft;
};
const server = (change?: (draft: InspectionRecord) => void) => ({
  ...local(change),
  version: "BBB=",
});

const room = (draft: InspectionRecord, id: string) =>
  draft.rooms.find((entry) => entry.id === id) as RoomRecord;
const itemOf = (draft: InspectionRecord, roomId: string, id: string) =>
  room(draft, roomId).items.find((entry) => entry.id === id) as ItemRecord;
const ids = (list: { id: string; position: number }[]) =>
  list.map((entry) => `${entry.id}@${entry.position}`);

describe("mergeInspection", () => {
  it("nada mudou: a base com a version do servidor, sem colisão", () => {
    expect(mergeInspection(base, local(), server())).toEqual({
      merged: { ...base, version: "BBB=" },
      collisions: [],
    });
  });

  describe("item", () => {
    it("mesmo item, campos diferentes: os dois entram, sem colisão", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => (itemOf(v, "r1", "t1").condition = "good")),
        server((v) => (itemOf(v, "r1", "t1").notes = "Risco perto da porta.")),
      );
      expect(collisions).toEqual([]);
      expect(itemOf(merged, "r1", "t1")).toEqual({
        ...item("t1", "Piso", 0),
        condition: "good",
        notes: "Risco perto da porta.",
      });
    });

    it("mesmo item, condições diferentes: uma colisão no caminho do item, e o merged fica com o local", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => (itemOf(v, "r2", "t4").condition = "good")),
        server((v) => (itemOf(v, "r2", "t4").condition = "poor")),
      );
      expect(collisions).toEqual([
        {
          kind: "field",
          roomId: "r2",
          itemId: "t4",
          field: "condition",
          base: null,
          local: "good",
          server: "poor",
        },
      ]);
      expect(itemOf(merged, "r2", "t4").condition).toBe("good");
    });

    it("item novo nos dois lados: os dois entram, o do servidor primeiro, renumerados", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => room(v, "r1").items.push(item("t5", "Janela", 2))),
        server((v) => room(v, "r1").items.push(item("t6", "Porta", 2))),
      );
      expect(collisions).toEqual([]);
      expect(ids(room(merged, "r1").items)).toEqual(["t1@0", "t2@1", "t6@2", "t5@3"]);
    });

    const removeT1 = (v: InspectionRecord) => {
      room(v, "r1").items = [{ ...itemOf(v, "r1", "t2"), position: 0 }];
    };

    it.each([
      ["no local", local(removeT1), server()],
      ["no servidor", local(), server(removeT1)],
    ])("removido %s e intocado do outro lado: sai", (_, mine, theirs) => {
      const { merged, collisions } = mergeInspection(base, mine, theirs);
      expect(collisions).toEqual([]);
      expect(ids(room(merged, "r1").items)).toEqual(["t2@0"]);
    });

    it("removido no local e editado no servidor: colisão, e o item fica fora até a escolha", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => (room(v, "r1").items = [{ ...itemOf(v, "r1", "t2"), position: 0 }])),
        server((v) => (itemOf(v, "r1", "t1").condition = "fair")),
      );
      expect(collisions).toEqual([
        {
          kind: "removed",
          roomId: "r1",
          itemId: "t1",
          base: item("t1", "Piso", 0),
          local: undefined,
          server: { ...item("t1", "Piso", 0), condition: "fair" },
        },
      ]);
      expect(ids(room(merged, "r1").items)).toEqual(["t2@0"]);
    });

    it("editado no local e removido no servidor: colisão, e o item fica com a edição local", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => (itemOf(v, "r1", "t1").notes = "Trincado.")),
        server((v) => (room(v, "r1").items = [{ ...itemOf(v, "r1", "t2"), position: 0 }])),
      );
      expect(collisions).toEqual([
        {
          kind: "removed",
          roomId: "r1",
          itemId: "t1",
          base: item("t1", "Piso", 0),
          local: { ...item("t1", "Piso", 0), notes: "Trincado." },
          server: undefined,
        },
      ]);
      expect(itemOf(merged, "r1", "t1").notes).toBe("Trincado.");
      // O servidor renumerou o t2 para 0 ao remover o t1; no empate, a ordem do servidor vem primeiro.
      expect(ids(room(merged, "r1").items)).toEqual(["t2@0", "t1@1"]);
    });

    it("removido dos dois lados: sai, sem colisão", () => {
      const removed = (v: InspectionRecord) => {
        room(v, "r2").items = [{ ...itemOf(v, "r2", "t4"), position: 0 }];
      };
      const { merged, collisions } = mergeInspection(base, local(removed), server(removed));
      expect(collisions).toEqual([]);
      expect(ids(room(merged, "r2").items)).toEqual(["t4@0"]);
    });
  });

  describe("ambiente", () => {
    it("campos do ambiente: o que só um lado mudou entra, o que os dois mudaram colide no caminho do ambiente", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => {
          room(v, "r1").name = "Sala de estar";
          room(v, "r2").notes = "Sem gás.";
        }),
        server((v) => (room(v, "r2").notes = "Gás desligado.")),
      );
      expect(collisions).toEqual([
        {
          kind: "field",
          roomId: "r2",
          field: "notes",
          base: null,
          local: "Sem gás.",
          server: "Gás desligado.",
        },
      ]);
      expect(room(merged, "r1").name).toBe("Sala de estar");
      expect(room(merged, "r2").notes).toBe("Sem gás.");
    });

    it("ambiente novo de um lado: entra inteiro", () => {
      const banheiro: RoomRecord = {
        id: "r3",
        name: "Banheiro",
        position: 2,
        notes: null,
        items: [item("t7", "Box", 0)],
      };
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => v.rooms.push(banheiro)),
        server(),
      );
      expect(collisions).toEqual([]);
      expect(ids(merged.rooms)).toEqual(["r1@0", "r2@1", "r3@2"]);
      expect(room(merged, "r3")).toEqual(banheiro);
    });

    it("removido de um lado e intocado do outro: sai, e os vizinhos que só mudaram de posição não contam como edição", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local(),
        server((v) => (v.rooms = [{ ...room(v, "r2"), position: 0 }])),
      );
      expect(collisions).toEqual([]);
      expect(ids(merged.rooms)).toEqual(["r2@0"]);
    });

    it("removido no servidor e com um item editado no local: uma colisão só, no ambiente", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => (itemOf(v, "r1", "t2").condition = "good")),
        server((v) => (v.rooms = [{ ...room(v, "r2"), position: 0 }])),
      );
      expect(collisions).toEqual([
        {
          kind: "removed",
          roomId: "r1",
          base: base.rooms[0],
          local: room(
            local((v) => (itemOf(v, "r1", "t2").condition = "good")),
            "r1",
          ),
          server: undefined,
        },
      ]);
      expect(ids(merged.rooms)).toEqual(["r2@0", "r1@1"]);
    });
  });

  describe("raiz", () => {
    it("o que só um lado mudou entra; o que os dois mudaram colide sem caminho de ambiente", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => {
          v.generalNotes = "Chaves com o porteiro.";
          itemOf(v, "r1", "t1").condition = "good";
        }),
        server((v) => {
          v.generalNotes = "Chaves na portaria.";
          v.startedAt = "2026-10-26T12:00:00.0000000+00:00";
        }),
      );
      expect(collisions).toEqual([
        {
          kind: "field",
          field: "generalNotes",
          base: null,
          local: "Chaves com o porteiro.",
          server: "Chaves na portaria.",
        },
      ]);
      expect(merged).toMatchObject({
        version: "BBB=",
        generalNotes: "Chaves com o porteiro.",
        startedAt: "2026-10-26T12:00:00.0000000+00:00",
      });
      expect(itemOf(merged, "r1", "t1").condition).toBe("good");
    });

    it("a mesma data em formatos diferentes não é mudança", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => (v.generalNotes = "Imóvel vazio.")),
        server((v) => (v.startedAt = "2026-10-26T13:00:00.0000000+00:00")),
      );
      expect(collisions).toEqual([]);
      expect(merged.generalNotes).toBe("Imóvel vazio.");
    });
  });

  describe("ordem", () => {
    it("os dois mudaram a posição do mesmo ambiente: sem colisão, vale o local, renumerado", () => {
      const { merged, collisions } = mergeInspection(
        base,
        local((v) => {
          room(v, "r1").position = 5;
          room(v, "r2").position = 0;
        }),
        server((v) => (room(v, "r1").position = 3)),
      );
      expect(collisions).toEqual([]);
      expect(ids(merged.rooms)).toEqual(["r2@0", "r1@1"]);
    });

    it("posições repetidas: no empate, a ordem do servidor e depois a do aparelho", () => {
      const { merged } = mergeInspection(
        base,
        local((v) => room(v, "r2").items.unshift(item("t8", "Fogão", 0))),
        server(),
      );
      expect(ids(room(merged, "r2").items)).toEqual(["t3@0", "t8@1", "t4@2"]);
    });
  });

  describe("sem base", () => {
    it("o que é igual não colide; o que difere colide, e ambiente de um lado só vira removed", () => {
      const banheiro: RoomRecord = {
        id: "r3",
        name: "Banheiro",
        position: 2,
        notes: null,
        items: [],
      };
      const { merged, collisions } = mergeInspection(
        undefined,
        local((v) => {
          v.rooms.push(banheiro);
          itemOf(v, "r1", "t1").condition = "good";
        }),
        server(),
      );
      expect(collisions).toEqual([
        {
          kind: "field",
          roomId: "r1",
          itemId: "t1",
          field: "condition",
          base: undefined,
          local: "good",
          server: null,
        },
        {
          kind: "removed",
          roomId: "r3",
          base: undefined,
          local: banheiro,
          server: undefined,
        },
      ]);
      expect(ids(merged.rooms)).toEqual(["r1@0", "r2@1", "r3@2"]);
    });
  });
});
