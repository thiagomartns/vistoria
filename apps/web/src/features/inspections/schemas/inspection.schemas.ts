import { z } from "zod";

import {
  zItemCondition,
  zUpsertInspectionDto,
  zUpsertInspectionItemDto,
  zUpsertRoomDto,
} from "@/shared/api/generated/zod.gen";
import { maxItemsOf } from "@/shared/api/zod-limits";

import type { InspectionRecord, ItemCondition } from "../models/inspection";

// O formulário da tela de campo (frontend.md, "Formulários profundos"): os ambientes e os itens na ordem da tela, com
// o id de cada um, o nome, a condição e a observação (ADR 0058). A ordem é a da lista: a `position` sai do índice ao
// montar o registro. Os ids ficam em `roomId` e `itemId`, porque o `useFieldArray` usa o `id` dos campos como chave
// dele. O que a tela não edita (a observação do ambiente, a cópia da entrada na saída) vem do registro, pelo id. A
// observação é "" no formulário e null no registro. Os limites vêm do Zod gerado; as mensagens são as do .NET
// (InspectionDtos.cs), que confere tudo de novo.

export interface ItemFormValues {
  itemId: string;
  name: string;
  condition: ItemCondition | null;
  notes: string;
}

export interface RoomFormValues {
  roomId: string;
  name: string;
  items: ItemFormValues[];
}

export interface InspectionFormValues {
  rooms: RoomFormValues[];
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

/** Até quantos ambientes uma vistoria tem (o contador "7 de 40" e o botão que desabilita no limite). */
export const ROOMS_MAX = maxItemsOf(zUpsertInspectionDto.shape.rooms);
/** Até quantos itens um ambiente tem. */
export const ITEMS_MAX = maxItemsOf(zUpsertRoomDto.shape.items);

const ROOM_NAME_MIN = zUpsertRoomDto.shape.name.minLength ?? 1;
const ROOM_NAME_MAX = zUpsertRoomDto.shape.name.maxLength ?? 60;
const ITEM_NAME_MIN = zUpsertInspectionItemDto.shape.name.minLength ?? 1;
const ITEM_NAME_MAX = zUpsertInspectionItemDto.shape.name.maxLength ?? 60;

export const ROOM_NAME_REQUIRED = "Informe o nome do ambiente.";
export const ROOM_NAME_LENGTH = `O nome do ambiente precisa ter de ${ROOM_NAME_MIN} a ${ROOM_NAME_MAX} caracteres.`;
export const ITEM_NAME_REQUIRED = "Informe o nome do item.";
export const ITEM_NAME_LENGTH = `O nome do item precisa ter de ${ITEM_NAME_MIN} a ${ITEM_NAME_MAX} caracteres.`;
export const TOO_MANY_ROOMS = `A vistoria pode ter até ${ROOMS_MAX} ambientes.`;
export const TOO_MANY_ITEMS = `O ambiente pode ter até ${ITEMS_MAX} itens.`;

/** O nome sem os espaços das pontas: vazio pede o nome, longo demais diz o tamanho (o `[Required]` e o `[StringLength]`). */
const nameSchema = (required: string, length: string, max: number) =>
  z.string().trim().min(1, required).max(max, length);

const itemSchema = z.object({
  name: nameSchema(ITEM_NAME_REQUIRED, ITEM_NAME_LENGTH, ITEM_NAME_MAX),
  condition: zItemCondition.nullable(),
  notes: z.string().max(NOTES_MAX, NOTES_TOO_LONG),
});

const itemsSchema = z.array(itemSchema).max(ITEMS_MAX, TOO_MANY_ITEMS);

/** Avançar de ambiente: confere os itens do ambiente atual. Não exige condição (isso é do concluir). */
export const roomStepSchema = z.object({ items: itemsSchema });

/**
 * O que precisa valer para a vistoria ir para a fila (o corpo do `PUT`): os nomes de ambientes e itens e os limites
 * das listas. Com algo errado, ela fica só no rascunho, porque o servidor recusaria o `PUT`.
 */
export const structureSchema = z.object({
  rooms: z
    .array(
      z.object({
        name: nameSchema(ROOM_NAME_REQUIRED, ROOM_NAME_LENGTH, ROOM_NAME_MAX),
        items: itemsSchema,
      }),
    )
    .max(ROOMS_MAX, TOO_MANY_ROOMS),
});

/** O caminho de um erro do Zod no formato do formulário (`rooms.2.items.4.name`). */
const formKey = (path: readonly PropertyKey[]) => path.map(String).join(".");

/**
 * Os erros da estrutura, no caminho do formulário (`rooms.2.name`, `rooms.2.items.4.name`, `rooms.2.items`, `rooms`).
 * Vazio: pode ir para a fila.
 */
export function structureErrors(values: InspectionFormValues): Record<string, string> {
  const result = structureSchema.safeParse(values);
  const errors: Record<string, string> = {};
  for (const issue of result.error?.issues ?? []) errors[formKey(issue.path)] ??= issue.message;
  return errors;
}

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
      roomId: room.id,
      name: room.name,
      items: room.items.map((item) => ({
        itemId: item.id,
        name: item.name,
        condition: item.condition,
        notes: item.notes ?? "",
      })),
    })),
  };
}

/**
 * O registro com os valores do formulário por cima: o que vai para o rascunho e para a fila. Os ambientes e os itens
 * são os do formulário, na ordem dele, com a `position` do índice (o que saiu da lista sai do `PUT`, e o servidor o
 * marca como excluído). O resto de cada um (a observação do ambiente, a cópia da entrada num item da saída) vem do
 * registro, pelo id; o que é novo nasce sem.
 */
export function recordWith<T extends Pick<InspectionRecord, "rooms">>(
  record: T,
  values: InspectionFormValues,
): T {
  const rooms = new Map(record.rooms.map((room) => [room.id, room]));
  const items = new Map(record.rooms.flatMap((room) => room.items).map((item) => [item.id, item]));
  return {
    ...record,
    rooms: values.rooms.map((room, position) => ({
      notes: null,
      ...rooms.get(room.roomId),
      id: room.roomId,
      name: room.name.trim(),
      position,
      items: room.items.map((item, index) => {
        const notes = item.notes.trim();
        return {
          ...items.get(item.itemId),
          id: item.itemId,
          name: item.name.trim(),
          position: index,
          condition: item.condition,
          notes: notes === "" ? null : item.notes,
        };
      }),
    })),
  };
}

type FormPath =
  | `rooms.${number}.name`
  | `rooms.${number}.items.${number}.${"name" | "condition" | "notes"}`;

/**
 * Da chave de erro do backend para o caminho do formulário: `rooms[2].items[4].condition` →
 * `rooms.2.items.4.condition`, `rooms[1].name` → `rooms.1.name`. O que não é um campo do formulário → `undefined`.
 */
export function formPathOf(key: string): FormPath | undefined {
  const item = /^rooms\[(\d+)\]\.items\[(\d+)\]\.(condition|notes|name)$/i.exec(key);
  if (item) {
    const [, room, index, field] = item;
    return `rooms.${Number(room)}.items.${Number(index)}.${field!.toLowerCase() as "condition" | "notes" | "name"}`;
  }
  const room = /^rooms\[(\d+)\]\.name$/i.exec(key);
  return room ? `rooms.${Number(room[1])}.name` : undefined;
}

/** O índice do ambiente de uma chave de erro do backend (`rooms[2]...` → 2), ou `undefined`. */
export function roomOfError(key: string): number | undefined {
  const match = /^rooms\[(\d+)\]/i.exec(key);
  return match ? Number(match[1]) : undefined;
}
