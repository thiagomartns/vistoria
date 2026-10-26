// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { DraftRecord } from "@/shared/sync/drafts";

import type { InspectionRecord } from "../models/inspection";
import { inspectionRowOf, inspectionRows } from "./inspections.view";

const inspection = (id: string, over: Partial<InspectionRecord> = {}): InspectionRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: "2026-10-26T13:00:00.000Z",
  generalNotes: null,
  rooms: [
    {
      id: `${id}-r1`,
      name: "Sala",
      position: 0,
      notes: null,
      items: [
        { id: `${id}-t1`, name: "Piso", position: 0, condition: "good", notes: null },
        { id: `${id}-t2`, name: "Paredes", position: 1, condition: null, notes: null },
      ],
    },
  ],
  ...over,
});

const rejected = (record: InspectionRecord): DraftRecord => ({
  id: record.id,
  entity: "inspection",
  data: record,
  status: "rejected",
  errors: { propertyId: ["Imóvel não encontrado."] },
  updatedAt: "2026-10-26T13:10:00.000Z",
});

const addresses = new Map([["p1", "Rua das Flores, 120 · ap 32"]]);

describe("inspectionRowOf", () => {
  it("endereço do imóvel, tipo, itens avaliados e sincronizada sem transação na fila", () => {
    expect(inspectionRowOf(inspection("i1"), undefined, undefined, addresses)).toEqual({
      id: "i1",
      propertyId: "p1",
      address: "Rua das Flores, 120 · ap 32",
      kindLabel: "Entrada",
      startedAt: "2026-10-26T13:00:00.000Z",
      evaluated: 1,
      items: 2,
      sync: "sincronizado",
    });
  });

  it("com transação na fila, o estado dela; imóvel fora do aparelho, sem endereço", () => {
    expect(inspectionRowOf(inspection("i1", { propertyId: "p9" }), undefined, "local", addresses)).toMatchObject({
      address: null,
      sync: "local",
    });
  });

  it("o rascunho recusado vence: mostra o que foi enviado, como rejeitado", () => {
    const sent = inspection("i1", { kind: "moveOut" });

    expect(inspectionRowOf(inspection("i1"), rejected(sent), "local", addresses)).toMatchObject({
      kindLabel: "Saída",
      sync: "rejeitado",
    });
  });
});

describe("inspectionRows", () => {
  it("vistorias e rascunhos de vistoria (só os de vistoria), da mais recente para a mais antiga", () => {
    const older = inspection("i1", { startedAt: "2026-10-25T09:00:00.000Z" });
    const newer = inspection("i2", { startedAt: "2026-10-26T09:00:00.000Z" });
    const onlyDraft = inspection("i3", { startedAt: "2026-10-26T12:00:00.000Z" });
    const otherEntity: DraftRecord = { ...rejected(inspection("x1")), entity: "property" };

    const rows = inspectionRows([older, newer], [rejected(onlyDraft), otherEntity], new Map(), addresses);

    expect(rows.map((row) => [row.id, row.sync])).toEqual([
      ["i3", "rejeitado"],
      ["i2", "sincronizado"],
      ["i1", "sincronizado"],
    ]);
  });
});
