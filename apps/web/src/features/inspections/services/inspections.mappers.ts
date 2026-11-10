import type { InspectionDto } from "@/shared/api/generated";

import type { InspectionRecord } from "../models/inspection";

/**
 * Do DTO do servidor para o registro local: fica o que vai no `PUT`, a `version` e, só na concluída, o `completedAt`
 * (ADR 0050); saem as outras datas, que o servidor define. A referência da saída só entra quando existe (ADR 0052): o
 * `referenceInspectionId` na saída e a cópia no item que veio da entrada. Cada chave opcional só existe quando o DTO a
 * traz: o registro tem as mesmas chaves do criado no aparelho, e o merge não vê um campo a mais. É a base do pull (M4)
 * e de adotar um `current`.
 */
export function inspectionRecordOf(dto: InspectionDto): InspectionRecord {
  return {
    id: dto.id,
    version: dto.version,
    propertyId: dto.propertyId,
    kind: dto.kind,
    status: dto.status,
    startedAt: dto.startedAt,
    ...(dto.completedAt && { completedAt: dto.completedAt }),
    ...(dto.referenceInspectionId && { referenceInspectionId: dto.referenceInspectionId }),
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
        ...(item.referenceCondition && {
          referenceCondition: item.referenceCondition,
          referenceNotes: item.referenceNotes,
        }),
      })),
    })),
  };
}
