import type {
  InspectionKind,
  InspectionStatus,
  ItemCondition,
  UpsertInspectionDto,
  UpsertInspectionItemDto,
  UpsertRoomDto,
} from "@/shared/api/generated";

// Os nuláveis do DTO de entrada são nuláveis só para o `[Required]` do .NET pegar o campo ausente; aqui eles sempre
// existem. As datas que o servidor define não existem no registro, então nunca vão no `PUT`. A exceção é o
// `completedAt` da concluída (ADR 0050): ele fica no registro para a tela e o laudo, e o envio o tira do corpo. A
// referência da saída (`referenceInspectionId` na raiz, `referenceCondition` e `referenceNotes` no item copiado da
// entrada) só existe quando há uma (ADR 0052): a entrada e o item posto depois não têm a chave. Ela vai no `PUT` como
// está; o servidor a grava na criação e a ignora depois (ADR 0051).

/** Item no banco local: o corpo do `PUT`, com o `id` gerado no aparelho. */
export type ItemRecord = Required<
  Omit<UpsertInspectionItemDto, "id" | "position" | "referenceCondition" | "referenceNotes">
> & {
  id: string;
  position: number;
  /** Só no item da saída copiado da entrada: a condição que ele tinha nela. Somente leitura. */
  referenceCondition?: ItemCondition;
  /** Junto da `referenceCondition`: a observação da entrada, `null` quando ela não tinha. */
  referenceNotes?: string | null;
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
  /**
   * Quando o servidor concluiu a vistoria (ADR 0050): só existe na concluída que ele confirmou (a resposta do `PUT`, o
   * pull ou o `current` de um `locked`). A concluída que ainda está na fila não tem. Nunca vai no `PUT`.
   */
  completedAt?: string;
  /** Só na saída: a entrada concluída de onde ela foi copiada (ADR 0052). */
  referenceInspectionId?: string;
} & Required<
  Omit<UpsertInspectionDto, "propertyId" | "kind" | "status" | "startedAt" | "rooms" | "referenceInspectionId">
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
