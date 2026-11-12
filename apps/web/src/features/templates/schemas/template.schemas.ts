import { z } from "zod";

import {
  zUpsertTemplateDto,
  zUpsertTemplateItemDto,
  zUpsertTemplateRoomDto,
} from "@/shared/api/generated/zod.gen";

// O editor de roteiro sobre o Zod gerado: os limites vêm do contrato (nome de 1 a 60, até 40 ambientes, até 60 itens
// por ambiente, nomes até 60). A UI soma o que o OpenAPI não expressa (nome de ambiente e de item obrigatório, trim) e
// tira a `position` do índice: a ordem é a da lista, como o servidor guarda. As mensagens são as do .NET
// (TemplateDtos.cs), que confere tudo de novo.

/** O `.max()` de uma lista do Zod gerado, pelo JSON Schema dela. */
function maxOf(schema: z.ZodArray): number {
  const { maxItems } = z.toJSONSchema(schema);
  if (maxItems === undefined) throw new Error("Lista do contrato sem limite.");
  return maxItems;
}

/** Até quantos ambientes um roteiro tem (o contador "6 de 40" e o botão que desabilita no limite). */
export const ROOMS_MAX = maxOf(zUpsertTemplateDto.shape.rooms);
/** Até quantos itens um ambiente tem. */
export const ITEMS_MAX = maxOf(zUpsertTemplateRoomDto.shape.items);

const required = (schema: z.ZodString) => z.string().trim().pipe(schema.min(1));

const itemSchema = z.object({
  itemId: z.string(),
  name: required(zUpsertTemplateItemDto.shape.name),
});

const roomSchema = z.object({
  roomId: z.string(),
  name: required(zUpsertTemplateRoomDto.shape.name),
  items: z.array(itemSchema).max(ITEMS_MAX),
});

/**
 * O formulário: os ids de ambiente e item ficam em `roomId` e `itemId`, porque o `useFieldArray` usa o `id` dos
 * campos como chave dele. Ao salvar, voltam a `id`, com a `position` do índice.
 */
export const templateFormSchema = z
  .object({
    name: z.string().trim().pipe(zUpsertTemplateDto.shape.name),
    rooms: z.array(roomSchema).max(ROOMS_MAX),
  })
  .transform(({ name, rooms }) => ({
    name,
    rooms: rooms.map((room, position) => ({
      id: room.roomId,
      name: room.name,
      position,
      items: room.items.map((item, index) => ({
        id: item.itemId,
        name: item.name,
        position: index,
      })),
    })),
  }));

/** O que o formulário edita. */
export type TemplateFormValues = z.input<typeof templateFormSchema>;
export type RoomFormValues = TemplateFormValues["rooms"][number];
export type ItemFormValues = RoomFormValues["items"][number];
/** O que o formulário entrega ao salvar: o corpo do `PUT`, com ids e posições. */
export type TemplateFormOutput = z.output<typeof templateFormSchema>;

type Messages = { required?: string; length: string };

const MESSAGES = {
  name: { required: "Informe o nome.", length: "O nome precisa ter de 1 a 60 caracteres." },
  rooms: { length: `O roteiro pode ter até ${ROOMS_MAX} ambientes.` },
  roomName: {
    required: "Informe o nome do ambiente.",
    length: "O nome do ambiente pode ter até 60 caracteres.",
  },
  items: { length: `O ambiente pode ter até ${ITEMS_MAX} itens.` },
  itemName: {
    required: "Informe o nome do item.",
    length: "O nome do item pode ter até 60 caracteres.",
  },
} satisfies Record<string, Messages>;

/** O campo de um caminho do formulário: `name`, `rooms`, `rooms.0.name`, `rooms.0.items` ou `rooms.0.items.1.name`. */
function messagesOf(path: readonly PropertyKey[]): Messages | undefined {
  const keys = path.filter((key) => typeof key === "string");
  const last = keys.at(-1);
  if (keys.length === 1)
    return last === "name" ? MESSAGES.name : last === "rooms" ? MESSAGES.rooms : undefined;
  if (last === "items") return MESSAGES.items;
  if (last === "name") return keys.includes("items") ? MESSAGES.itemName : MESSAGES.roomName;
  return undefined;
}

/** Para o `zodResolver(templateFormSchema, templateErrors)`. */
export const templateErrors: { error: z.core.$ZodErrorMap } = {
  error: (issue) => {
    const field = messagesOf(issue.path ?? []);
    if (!field) return undefined;
    if (issue.input === "" && field.required) return field.required;
    return field.length;
  },
};

/**
 * A chave de um erro do servidor (`rooms[2].items[4].name`, backend.md, "Erros") no caminho do formulário
 * (`rooms.2.items.4.name`), ou null se o formulário não tem um campo para ele (o erro fica no Alert). Os limites de
 * ambientes e itens não chegam ao servidor, porque o botão de adicionar desabilita no limite.
 */
export function formPathOf(key: string): string | null {
  const path = key.replace(/\[(\d+)\]/g, ".$1");
  return /^(name|rooms\.\d+\.(name|items\.\d+\.name))$/.test(path) ? path : null;
}
