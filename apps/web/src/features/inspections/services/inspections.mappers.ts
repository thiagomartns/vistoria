import type { InspectionDto } from "@/shared/api/generated";

import type { InspectionRecord } from "../models/inspection";

/**
 * Do DTO do servidor para o registro local: fica o que vai no `PUT` e a `version`; saem `completedAt`, os campos de
 * referência da saída e as datas, que o servidor define. É a base do pull (M4) e de adotar um `current`.
 */
export function inspectionRecordOf(dto: InspectionDto): InspectionRecord {
  return {
    id: dto.id,
    version: dto.version,
    propertyId: dto.propertyId,
    kind: dto.kind,
    status: dto.status,
    startedAt: dto.startedAt,
    generalNotes: dto.generalNotes,
    rooms: dto.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      position: room.position,
      notes: room.notes,
      items: room.items.map((item) => ({
        id: item.id,
        name: item.name,
        position: item.position,
        condition: item.condition,
        notes: item.notes,
      })),
    })),
  };
}
