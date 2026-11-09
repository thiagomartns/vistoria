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

/** Avançar de ambiente: confere os itens do ambiente atual. Não exige condição (isso é do concluir). */
export const roomStepSchema = z.object({ items: z.array(itemSchema) });

// As mensagens da conclusão são as do .NET (InspectionService.cs), que confere tudo de novo no `PUT`.
export const NO_ROOMS = "Para concluir, a vistoria precisa de ao menos um ambiente.";
export const NO_ITEMS = "Para concluir, o ambiente precisa de ao menos um item.";
export const NO_CONDITION = "Para concluir, avalie a condição do item.";

/**
 * Concluir (vision.md, "Regras de negócio"): ao menos um ambiente, ao menos um item em cada um e a condição em todos os
 * itens. Confere a vistoria com os valores do formulário por cima (`recordWith`), na forma do corpo do `PUT`.
 */
export const completeInspectionSchema = z.object({
  rooms: z
    .array(
      z.object({
        items: z
          .array(
            z.object({
              condition: zItemCondition.nullable().refine((value) => value !== null, NO_CONDITION),
            }),
          )
          .min(1, NO_ITEMS),
      }),
    )
    .min(1, NO_ROOMS),
});

/**
 * O que falta para concluir, com as chaves no caminho do backend (`rooms[2].items[4].condition`, `rooms[1].items`,
 * `rooms`) e a mensagem do .NET: a recusa conferida no aparelho e a que vem do servidor passam pelo mesmo `formPathOf` e
 * `roomOfError`. Vazio: pode concluir.
 */
export function completionErrors(
  record: Pick<InspectionRecord, "rooms">,
): Record<string, string[]> {
  const result = completeInspectionSchema.safeParse(record);
  const errors: Record<string, string[]> = {};
  for (const issue of result.error?.issues ?? []) {
    const key = issue.path
      .map((part, index) => (typeof part === "number" ? `[${part}]` : index === 0 ? String(part) : `.${String(part)}`))
      .join("");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

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
 * Os valores do formulário para `next`, uma versão nova que o pull trouxe com a tela aberta, sem perder o que a pessoa
 * marcou e ainda não foi para o rascunho: os itens em que `values` difere de `defaults`, na estrutura de `shown` (o
 * registro que o formulário mostrava), casados com os de `next` pelo id. Um item que saiu em `next` leva a marcação
 * junto (ADR 0043).
 */
export function withUnsaved(
  next: Pick<InspectionRecord, "rooms">,
  shown: Pick<InspectionRecord, "rooms">,
  values: InspectionFormValues,
  defaults: InspectionFormValues,
): InspectionFormValues {
  const unsaved = new Map<string, ItemFormValues>();
  shown.rooms.forEach((room, r) => {
    room.items.forEach((item, i) => {
      const value = values.rooms[r]?.items[i];
      const base = defaults.rooms[r]?.items[i];
      if (value && (value.condition !== base?.condition || value.notes !== base?.notes)) {
        unsaved.set(item.id, value);
      }
    });
  });
  const fresh = formValuesOf(next);
  return {
    rooms: next.rooms.map((room, r) => ({
      items: room.items.map((item, i) => unsaved.get(item.id) ?? fresh.rooms[r]!.items[i]!),
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
