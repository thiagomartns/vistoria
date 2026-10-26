import { newId } from "@/shared/sync/ids";

import type { InspectionRecord } from "../models/inspection";

/**
 * O roteiro fixo da nova vistoria até os roteiros editáveis (M5), o corte que o vision.md prevê em "Se atrasar". A
 * vistoria não guarda referência ao roteiro: ela copia os ambientes e os itens.
 */
export const FIXED_TEMPLATE: readonly { name: string; items: readonly string[] }[] = [
  {
    name: "Sala",
    items: ["Piso", "Paredes", "Teto", "Portas", "Janelas", "Iluminação", "Tomadas e interruptores"],
  },
  {
    name: "Cozinha",
    items: ["Piso", "Paredes", "Teto", "Pia e torneira", "Armários", "Tomadas e interruptores"],
  },
  {
    name: "Banheiro",
    items: ["Piso", "Paredes", "Teto", "Vaso sanitário", "Pia e torneira", "Box e chuveiro"],
  },
  { name: "Quarto", items: ["Piso", "Paredes", "Teto", "Porta", "Janela", "Armário"] },
  { name: "Área de serviço", items: ["Piso", "Paredes", "Tanque", "Torneira"] },
];

/**
 * Uma vistoria de entrada nova para o imóvel, a partir do roteiro fixo: em andamento, começada agora no aparelho, com
 * ids v7 do cliente na vistoria, nos ambientes e nos itens, e nenhum item avaliado.
 */
export function newMoveInInspection(propertyId: string, now: Date = new Date()): InspectionRecord {
  return {
    id: newId(),
    version: null,
    propertyId,
    kind: "moveIn",
    status: "inProgress",
    startedAt: now.toISOString(),
    generalNotes: null,
    rooms: FIXED_TEMPLATE.map((room, position) => ({
      id: newId(),
      name: room.name,
      position,
      notes: null,
      items: room.items.map((name, itemPosition) => ({
        id: newId(),
        name,
        position: itemPosition,
        condition: null,
        notes: null,
      })),
    })),
  };
}
