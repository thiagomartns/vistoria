// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { InspectionDto } from "@/shared/api/generated";

import { inspectionRecordOf } from "./inspections.mappers";

describe("inspectionRecordOf", () => {
  it("fica o corpo do PUT e a version; saem completedAt, os campos de referência e as datas", () => {
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
      rooms: [
        {
          id: "r1",
          name: "Sala",
          position: 0,
          notes: null,
          items: [{ id: "t1", name: "Piso", position: 0, condition: "good", notes: "Risco perto da porta." }],
        },
      ],
    });
  });
});
