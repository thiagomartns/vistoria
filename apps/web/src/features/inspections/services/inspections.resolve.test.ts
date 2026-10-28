import { describe, expect, it } from "vitest";

import type { DraftRecord } from "@/shared/sync/drafts";

import type { InspectionRecord, ItemRecord } from "../models/inspection";
import { collisionKey, inspectionConflictOf, resolveInspection } from "./inspections.resolve";
import { conflictGroups, conflictPlaces } from "./inspections.view";

// As escolhas do ConflictResolver sobre o merge da vistoria (#103): campo da raiz, do ambiente e do item, e ambiente ou
// item removido de um lado e alterado do outro.

const item = (id: string, name: string, position: number): ItemRecord => ({
  id,
  name,
  position,
  condition: null,
  notes: null,
});

const base: InspectionRecord = {
  id: "i1",
  version: "V1",
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
      items: [{ ...item("t1", "Piso", 0), condition: "good" }, item("t2", "Parede", 1)],
    },
    { id: "r2", name: "Cozinha", position: 1, notes: null, items: [item("t3", "Pia", 0)] },
  ],
};

function edited(change: (draft: InspectionRecord) => void, from: InspectionRecord = base) {
  const draft = structuredClone(from);
  change(draft);
  return draft;
}

const itemOf = (record: InspectionRecord, id: string) =>
  record.rooms.flatMap((room) => room.items).find((entry) => entry.id === id) as ItemRecord;

/** O rascunho em conflito, como a outbox o deixa (#104): o local, o `current` do servidor e a base. */
function draftOf(local: InspectionRecord, server: InspectionRecord, withBase = true): DraftRecord {
  const { version: _version, ...data } = local;
  return {
    id: base.id,
    entity: "inspection",
    data,
    status: "conflict",
    errors: {},
    conflict: {
      current: { ...server, updatedAt: "2026-10-27T14:58:00+00:00" },
      base: withBase ? base : undefined,
      collisions: [],
    },
    updatedAt: "2026-10-27T15:02:00.000Z",
  };
}

describe("inspectionConflictOf", () => {
  it("refaz o merge com o rascunho de agora, com as horas dos dois lados", () => {
    const conflict = inspectionConflictOf(
      draftOf(
        edited((v) => (itemOf(v, "t2").condition = "fair")),
        edited((v) => {
          itemOf(v, "t2").condition = "poor";
          v.version = "V2";
        }),
      ),
    );
    expect(conflict?.collisions.map(collisionKey)).toEqual(["room:r1:item:t2:condition"]);
    expect(conflict?.server.version).toBe("V2");
    expect(conflict?.localAt).toBe("2026-10-27T15:02:00.000Z");
    expect(conflict?.serverAt).toBe("2026-10-27T14:58:00+00:00");
  });

  it("sem rascunho em conflito, ou sem current (deleted), não há o que escolher", () => {
    expect(inspectionConflictOf(undefined)).toBeUndefined();
    expect(inspectionConflictOf({ ...draftOf(base, base), status: "draft" })).toBeUndefined();
    expect(
      inspectionConflictOf({
        ...draftOf(base, base),
        conflict: { current: undefined, collisions: [] },
      }),
    ).toBeUndefined();
  });
});

describe("resolveInspection", () => {
  it("campos da raiz, do ambiente e do item: 'meu' fica com o local, 'servidor' com o do servidor", () => {
    const local = edited((v) => {
      v.generalNotes = "Duas chaves.";
      v.rooms[0]!.notes = "Janela emperrada.";
      itemOf(v, "t2").condition = "fair";
    });
    const server = edited((v) => {
      v.generalNotes = "Uma chave.";
      v.rooms[0]!.notes = "Janela trincada.";
      itemOf(v, "t2").condition = "poor";
      v.version = "V2";
    });
    const conflict = inspectionConflictOf(draftOf(local, server))!;
    expect(conflict.collisions.map(collisionKey)).toEqual([
      "root:generalNotes",
      "room:r1:notes",
      "room:r1:item:t2:condition",
    ]);

    const resolved = resolveInspection(conflict, {
      "root:generalNotes": "servidor",
      "room:r1:notes": "meu",
      "room:r1:item:t2:condition": "servidor",
    });

    expect(resolved).toEqual(
      edited((v) => {
        v.generalNotes = "Uma chave.";
        v.rooms[0]!.notes = "Janela emperrada.";
        itemOf(v, "t2").condition = "poor";
        v.version = "V2";
      }),
    );
  });

  it("ambiente removido aqui e alterado no servidor: 'meu' tira, 'servidor' devolve o do servidor", () => {
    const local = edited((v) => (v.rooms = v.rooms.filter((room) => room.id !== "r2")));
    const server = edited((v) => {
      itemOf(v, "t3").condition = "poor";
      v.version = "V2";
    });
    const conflict = inspectionConflictOf(draftOf(local, server))!;
    expect(conflict.collisions.map(collisionKey)).toEqual(["removed:room:r2"]);

    expect(
      resolveInspection(conflict, { "removed:room:r2": "meu" }).rooms.map((r) => r.id),
    ).toEqual(["r1"]);
    expect(resolveInspection(conflict, { "removed:room:r2": "servidor" })).toEqual(server);
  });

  it("item removido no servidor e alterado aqui: 'meu' mantém, 'servidor' tira e renumera", () => {
    const local = edited((v) => (itemOf(v, "t1").notes = "Risco perto da porta."));
    const server = edited((v) => {
      v.rooms[0]!.items = v.rooms[0]!.items.filter((entry) => entry.id !== "t1");
      v.version = "V2";
    });
    const conflict = inspectionConflictOf(draftOf(local, server))!;
    expect(conflict.collisions.map(collisionKey)).toEqual(["removed:room:r1:item:t1"]);

    expect(resolveInspection(conflict, { "removed:room:r1:item:t1": "meu" })).toEqual({
      ...local,
      version: "V2",
    });
    const theirs = resolveInspection(conflict, { "removed:room:r1:item:t1": "servidor" });
    expect(theirs.rooms[0]!.items).toEqual([{ ...item("t2", "Parede", 0) }]);
  });
});

describe("conflictGroups", () => {
  const local = edited((v) => {
    v.generalNotes = "Duas chaves.";
    itemOf(v, "t1").condition = "fair";
    itemOf(v, "t2").notes = "Rachadura no rodapé.";
    v.rooms = v.rooms.filter((room) => room.id !== "r2");
  });
  const server = edited((v) => {
    v.generalNotes = "Uma chave.";
    itemOf(v, "t1").condition = "poor";
    itemOf(v, "t2").notes = "Rodapé solto.";
    itemOf(v, "t3").condition = "absent";
    v.version = "V2";
  });

  it("'Geral' primeiro e depois os ambientes, com rótulo, 'Antes' e os dois valores", () => {
    const conflict = inspectionConflictOf(draftOf(local, server))!;
    expect(conflictGroups(conflict)).toEqual([
      {
        id: "",
        title: "Geral",
        fields: [
          {
            key: "root:generalNotes",
            label: "Observações gerais",
            before: "Antes: sem observação",
            mine: "Duas chaves.",
            theirs: "Uma chave.",
          },
        ],
      },
      {
        id: "r1",
        title: "Sala",
        fields: [
          {
            key: "room:r1:item:t1:condition",
            label: "Piso · Condição",
            before: "Antes: Bom",
            mine: "Regular",
            theirs: "Ruim",
          },
          {
            key: "room:r1:item:t2:notes",
            label: "Parede · Observação",
            before: "Antes: sem observação",
            mine: "Rachadura no rodapé.",
            theirs: "Rodapé solto.",
          },
        ],
      },
      {
        id: "r2",
        title: "Cozinha",
        fields: [
          {
            key: "removed:room:r2",
            label: "Ambiente",
            before: null,
            mine: "Removido",
            theirs: "Mantido, com alterações",
          },
        ],
      },
    ]);
  });

  it("sem base, sem 'Antes'; o que só um lado tem é 'Incluído'", () => {
    const conflict = inspectionConflictOf(draftOf(local, server, false))!;
    const fields = conflictGroups(conflict).flatMap((group) => group.fields);
    expect(fields.every((field) => field.before === null)).toBe(true);
    expect(fields.find((field) => field.key === "removed:room:r2")).toMatchObject({
      mine: "Removido",
      theirs: "Incluído",
    });
  });

  it("os ambientes e itens em disputa, para a tela de campo", () => {
    const places = conflictPlaces(inspectionConflictOf(draftOf(local, server)));
    expect([...places.rooms]).toEqual(["r1", "r2"]);
    expect([...places.items]).toEqual(["t1", "t2"]);
  });
});
