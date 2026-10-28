import type {
  InspectionKind,
  InspectionStatus,
  ItemCondition,
  UpsertInspectionDto,
  UpsertInspectionItemDto,
  UpsertRoomDto,
} from "@/shared/api/generated";

// Os nuláveis do DTO de entrada são nuláveis só para o `[Required]` do .NET pegar o campo ausente; aqui eles sempre
// existem. Os campos que o servidor define (`completedAt`, `referenceInspectionId`, `referenceCondition`,
// `referenceNotes` e as datas) não existem no registro, então nunca vão no `PUT`.

/** Item no banco local: o corpo do `PUT`, com o `id` gerado no aparelho. */
export type ItemRecord = Required<Omit<UpsertInspectionItemDto, "id" | "position">> & {
  id: string;
  position: number;
};

/** Ambiente no banco local, com os itens. */
export type RoomRecord = Required<Omit<UpsertRoomDto, "id" | "position" | "items">> & {
  id: string;
  position: number;
  items: ItemRecord[];
};

/**
 * Vistoria no banco local: o agregado inteiro como vai no `PUT`, com o `id` gerado no aparelho e a `version` que o
 * servidor confirmou (`null` enquanto ela só existe no aparelho). A versão é do agregado: ambientes e itens não têm.
 */
export type InspectionRecord = {
  id: string;
  version: string | null;
  /** Só na camada otimista, com a exclusão na fila (ADR 0039): "Excluindo", só leitura. Nunca vai no `PUT`. */
  deleting?: true;
} & Required<
  Omit<UpsertInspectionDto, "propertyId" | "kind" | "status" | "startedAt" | "rooms">
> & {
    propertyId: string;
    kind: InspectionKind;
    status: InspectionStatus;
    startedAt: string;
    rooms: RoomRecord[];
  };

export type { InspectionKind, InspectionStatus, ItemCondition };

/** A entidade dos rascunhos de vistoria (`DraftRecord.entity`). */
export const INSPECTION_ENTITY = "inspection";
