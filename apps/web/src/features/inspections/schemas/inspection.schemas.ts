import { z } from "zod";

import { zItemCondition, zUpsertInspectionItemDto } from "@/shared/api/generated/zod.gen";

import type { InspectionRecord, ItemCondition } from "../models/inspection";

// O formulário da tela de campo (frontend.md, "Formulários profundos"): só o que se edita em campo, a condição e a
// observação de cada item, na ordem dos ambientes e dos itens do registro. Nomes, ids e posições vêm do registro (a
// estrutura não muda no M2). A observação é "" no formulário e null no registro. Os limites vêm do Zod gerado; a
// mensagem é a do .NET (InspectionDtos.cs), que confere tudo de novo.

export interface ItemFormValues {
  condition: ItemCondition | null;
  notes: string;
}

export interface InspectionFormValues {
  rooms: { items: ItemFormValues[] }[];
}

/** O rótulo de cada condição, na ordem dos chips. */
export const CONDITIONS = {
  new: "Novo",
  good: "Bom",
  fair: "Regular",
  poor: "Ruim",
  absent: "Ausente",
} as const satisfies Record<ItemCondition, string>;

export const CONDITION_VALUES = Object.keys(CONDITIONS) as ItemCondition[];

/** O tamanho máximo da observação de um item, do contrato. */
export const NOTES_MAX = zUpsertInspectionItemDto.shape.notes.unwrap().unwrap().maxLength ?? 1000;

export const NOTES_TOO_LONG = `As observações podem ter até ${NOTES_MAX} caracteres.`;

const itemSchema = z.object({
  condition: zItemCondition.nullable(),
  notes: z.string().max(NOTES_MAX, NOTES_TOO_LONG),
});

/** Avançar de ambiente: confere os itens do ambiente atual. Não exige condição (isso é do concluir, M5). */
export const roomStepSchema = z.object({ items: z.array(itemSchema) });

/** Os valores do formulário a partir do registro (ou do rascunho, que tem o mesmo formato). */
export function formValuesOf(record: Pick<InspectionRecord, "rooms">): InspectionFormValues {
  return {
    rooms: record.rooms.map((room) => ({
      items: room.items.map((item) => ({ condition: item.condition, notes: item.notes ?? "" })),
    })),
  };
}

/** O registro com os valores do formulário por cima: o que vai para o rascunho e para a fila. */
export function recordWith<T extends Pick<InspectionRecord, "rooms">>(
  record: T,
  values: InspectionFormValues,
): T {
  return {
    ...record,
    rooms: record.rooms.map((room, r) => ({
      ...room,
      items: room.items.map((item, i) => {
        const value = values.rooms[r]?.items[i];
        if (!value) return item;
        const notes = value.notes.trim();
        return { ...item, condition: value.condition, notes: notes === "" ? null : value.notes };
      }),
    })),
  };
}

/**
 * Da chave de erro do backend para o caminho do formulário: `rooms[2].items[4].condition` →
 * `rooms.2.items.4.condition`. Só condição e observação de item existem no formulário; o resto → `undefined`.
 */
export function formPathOf(
  key: string,
): `rooms.${number}.items.${number}.${"condition" | "notes"}` | undefined {
  const match = /^rooms\[(\d+)\]\.items\[(\d+)\]\.(condition|notes)$/i.exec(key);
  if (!match) return undefined;
  const [, room, item, field] = match;
  return `rooms.${Number(room)}.items.${Number(item)}.${field!.toLowerCase() as "condition" | "notes"}`;
}

/** O índice do ambiente de uma chave de erro do backend (`rooms[2]...` → 2), ou `undefined`. */
export function roomOfError(key: string): number | undefined {
  const match = /^rooms\[(\d+)\]/i.exec(key);
  return match ? Number(match[1]) : undefined;
}
