import type { InspectionRecord } from "../models/inspection";
import type { InspectionSummary } from "../models/inspection-summary";

/** O resumo de uma vistoria, como a store `inspectionSummaries` o guarda e a lista o lê (ADR 0048). */
export function summaryOf(inspection: InspectionRecord): InspectionSummary {
  const items = inspection.rooms.flatMap((room) => room.items);
  return {
    id: inspection.id,
    version: inspection.version,
    propertyId: inspection.propertyId,
    kind: inspection.kind,
    status: inspection.status,
    startedAt: inspection.startedAt,
    evaluated: items.filter((item) => item.condition != null).length,
    items: items.length,
  };
}
