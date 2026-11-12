import { newId } from "@/shared/sync/ids";

import type { InspectionRecord } from "../models/inspection";

/** Um ambiente como molde da entrada: o nome e os itens, na ordem em que a vistoria os recebe. */
export interface RoomMold {
  name: string;
  items: readonly { name: string }[];
}

const mold = (name: string, items: readonly string[]): RoomMold => ({
  name,
  items: items.map((item) => ({ name: item })),
});

/**
 * O roteiro padrão, embutido: a entrada parte dele só num aparelho sem nenhum roteiro (conta nova, #174). Não é gravado
 * no banco local nem enviado; a vistoria copia os ambientes e os itens, como de qualquer roteiro.
 */
export const DEFAULT_TEMPLATE: readonly RoomMold[] = [
  mold("Sala", ["Piso", "Paredes", "Teto", "Portas", "Janelas", "Iluminação", "Tomadas e interruptores"]),
  mold("Cozinha", ["Piso", "Paredes", "Teto", "Pia e torneira", "Armários", "Tomadas e interruptores"]),
  mold("Banheiro", ["Piso", "Paredes", "Teto", "Vaso sanitário", "Pia e torneira", "Box e chuveiro"]),
  mold("Quarto", ["Piso", "Paredes", "Teto", "Porta", "Janela", "Armário"]),
  mold("Área de serviço", ["Piso", "Paredes", "Tanque", "Torneira"]),
];

/**
 * Uma vistoria de entrada nova para o imóvel, a partir dos ambientes de um roteiro (vision.md, "Modelo de domínio"): em
 * andamento, começada agora no aparelho, com ids v7 do cliente na vistoria, nos ambientes e nos itens (os do roteiro
 * continuam dele), a `position` pela ordem recebida e nenhum item avaliado. A cópia é feita uma vez: só nomes passam
 * do roteiro para a vistoria, então editar o roteiro depois não a muda.
 */
export function newMoveInInspection(
  propertyId: string,
  rooms: readonly RoomMold[],
  now: Date = new Date(),
): InspectionRecord {
  return {
    id: newId(),
    version: null,
    propertyId,
    kind: "moveIn",
    status: "inProgress",
    startedAt: now.toISOString(),
    generalNotes: null,
    rooms: rooms.map((room, position) => ({
      id: newId(),
      name: room.name,
      position,
      notes: null,
      items: room.items.map((item, itemPosition) => ({
        id: newId(),
        name: item.name,
        position: itemPosition,
        condition: null,
        notes: null,
      })),
    })),
  };
}

/**
 * A vistoria de saída a partir da entrada concluída (vision.md, "Regras de negócio"): os mesmos ambientes e itens, com
 * ids v7 novos (os da entrada continuam dela no servidor), a condição e a observação da entrada copiadas em
 * `referenceCondition` e `referenceNotes`, e nada avaliado ainda. Em andamento, começada agora no aparelho, no imóvel
 * da entrada e apontando para ela. A cópia é feita uma vez: a saída não lê mais a entrada (ADR 0052).
 */
export function newMoveOutInspection(moveIn: InspectionRecord, now: Date = new Date()): InspectionRecord {
  return {
    id: newId(),
    version: null,
    propertyId: moveIn.propertyId,
    kind: "moveOut",
    status: "inProgress",
    startedAt: now.toISOString(),
    generalNotes: null,
    referenceInspectionId: moveIn.id,
    rooms: moveIn.rooms.map((room) => ({
      id: newId(),
      name: room.name,
      position: room.position,
      notes: null,
      items: room.items.map((item) => ({
        id: newId(),
        name: item.name,
        position: item.position,
        condition: null,
        notes: null,
        ...(item.condition && { referenceCondition: item.condition, referenceNotes: item.notes }),
      })),
    })),
  };
}
