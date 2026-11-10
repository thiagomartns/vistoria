// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { InspectionDto } from "@/shared/api/generated";

import { inspectionRecordOf } from "./inspections.mappers";

describe("inspectionRecordOf", () => {
  it("fica o corpo do PUT e a version; saem as datas; na saída, a referência e a cópia do item ficam (ADR 0052)", () => {
    const dto: InspectionDto = {
      id: "i1",
      propertyId: "p1",
      kind: "moveOut",
      status: "inProgress",
      referenceInspectionId: "i0",
      startedAt: "2026-10-26T13:00:00Z",
      completedAt: null,
      generalNotes: "Chaves com o porteiro.",
      rooms: [
        {
          id: "r1",
          name: "Sala",
          position: 0,
          notes: null,
          items: [
            {
              id: "t1",
              name: "Piso",
              position: 0,
              condition: "good",
              notes: "Risco perto da porta.",
              referenceCondition: "new",
              referenceNotes: null,
            },
          ],
        },
      ],
      version: "AAAAAAAAB9M=",
      createdAt: "2026-10-26T13:00:01Z",
      updatedAt: "2026-10-26T13:05:00Z",
    };

    expect(inspectionRecordOf(dto)).toEqual({
      id: "i1",
      version: "AAAAAAAAB9M=",
      propertyId: "p1",
      kind: "moveOut",
      status: "inProgress",
      startedAt: "2026-10-26T13:00:00Z",
      generalNotes: "Chaves com o porteiro.",
      referenceInspectionId: "i0",
      rooms: [
        {
          id: "r1",
          name: "Sala",
          position: 0,
          notes: null,
          items: [
            {
              id: "t1",
              name: "Piso",
              position: 0,
              condition: "good",
              notes: "Risco perto da porta.",
              referenceCondition: "new",
              referenceNotes: null,
            },
          ],
        },
      ],
    });
  });

  it("sem referência, as chaves nem existem: na entrada e no item da saída posto depois, sem cópia", () => {
    const item = {
      id: "t1",
      name: "Piso",
      position: 0,
      condition: null,
      notes: null,
      referenceCondition: null,
      referenceNotes: null,
    };
    const dto: InspectionDto = {
      id: "i3",
      propertyId: "p1",
      kind: "moveIn",
      status: "inProgress",
      referenceInspectionId: null,
      startedAt: "2026-10-26T13:00:00Z",
      completedAt: null,
      generalNotes: null,
      rooms: [{ id: "r1", name: "Sala", position: 0, notes: null, items: [item] }],
      version: "AAAAAAAAB9M=",
      createdAt: "2026-10-26T13:00:01Z",
      updatedAt: "2026-10-26T13:05:00Z",
    };

    const record = inspectionRecordOf(dto);

    expect(record).not.toHaveProperty("referenceInspectionId");
    expect(Object.keys(record.rooms[0]!.items[0]!)).toEqual(["id", "name", "position", "condition", "notes"]);
  });

  it("concluída: o completedAt do servidor fica no registro (ADR 0050); em andamento, a chave nem existe", () => {
    const dto: InspectionDto = {
      id: "i2",
      propertyId: "p1",
      kind: "moveIn",
      status: "completed",
      referenceInspectionId: null,
      startedAt: "2026-10-19T09:12:00Z",
      completedAt: "2026-10-19T14:32:00Z",
      generalNotes: null,
      rooms: [],
      version: "AAAAAAAAB9M=",
      createdAt: "2026-10-19T09:12:01Z",
      updatedAt: "2026-10-19T14:32:00Z",
    };

    expect(inspectionRecordOf(dto).completedAt).toBe("2026-10-19T14:32:00Z");
    expect(inspectionRecordOf({ ...dto, status: "inProgress", completedAt: null })).not.toHaveProperty(
      "completedAt",
    );
  });
});
