import { describe, expect, it } from "vitest";

import {
  ITEMS_MAX,
  ROOMS_MAX,
  type TemplateFormValues,
  formPathOf,
  templateErrors,
  templateFormSchema,
} from "./template.schemas";

const parse = (values: TemplateFormValues) => templateFormSchema.safeParse(values, templateErrors);
const messages = (values: TemplateFormValues) => {
  const result = parse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
};

const room = (name: string, items: string[] = []) => ({
  roomId: `r-${name}`,
  name,
  items: items.map((item) => ({ itemId: `i-${item}`, name: item })),
});

describe("templateFormSchema", () => {
  it("os limites vêm do contrato", () => {
    expect(ROOMS_MAX).toBe(40);
    expect(ITEMS_MAX).toBe(60);
  });

  it("sai como o corpo do PUT: ids de volta a `id` e a posição pelo índice, com trim", () => {
    const result = parse({
      name: "  Apartamento ",
      rooms: [room("Sala", ["Piso", " Teto "]), room("Cozinha")],
    });

    expect(result.data).toEqual({
      name: "Apartamento",
      rooms: [
        {
          id: "r-Sala",
          name: "Sala",
          position: 0,
          items: [
            { id: "i-Piso", name: "Piso", position: 0 },
            { id: "i- Teto ", name: "Teto", position: 1 },
          ],
        },
        { id: "r-Cozinha", name: "Cozinha", position: 1, items: [] },
      ],
    });
  });

  it("nomes obrigatórios, com as mensagens do .NET", () => {
    expect(messages({ name: " ", rooms: [room("", [""])] })).toEqual({
      name: "Informe o nome.",
      "rooms.0.name": "Informe o nome do ambiente.",
      "rooms.0.items.0.name": "Informe o nome do item.",
    });
  });

  it("nomes até 60 caracteres", () => {
    const long = "x".repeat(61);
    expect(messages({ name: long, rooms: [room(long, [long])] })).toEqual({
      name: "O nome precisa ter de 1 a 60 caracteres.",
      "rooms.0.name": "O nome do ambiente pode ter até 60 caracteres.",
      "rooms.0.items.0.name": "O nome do item pode ter até 60 caracteres.",
    });
  });

  it("até 40 ambientes e 60 itens por ambiente; roteiro sem ambiente vale, como no contrato", () => {
    const items = Array.from({ length: 61 }, (_, index) => `Item ${index}`);
    const rooms = Array.from({ length: 41 }, (_, index) => room(`Ambiente ${index}`));
    expect(messages({ name: "A", rooms })).toEqual({
      rooms: "O roteiro pode ter até 40 ambientes.",
    });
    expect(messages({ name: "A", rooms: [room("Sala", items)] })).toEqual({
      "rooms.0.items": "O ambiente pode ter até 60 itens.",
    });
    expect(parse({ name: "A", rooms: [] }).success).toBe(true);
  });
});

describe("formPathOf", () => {
  it("leva a chave do servidor ao caminho do react-hook-form", () => {
    expect(formPathOf("name")).toBe("name");
    expect(formPathOf("rooms[2].name")).toBe("rooms.2.name");
    expect(formPathOf("rooms[2].items[4].name")).toBe("rooms.2.items.4.name");
  });

  it("o que o formulário não tem fica de fora (vai para o Alert)", () => {
    expect(formPathOf("rooms")).toBeNull();
    expect(formPathOf("rooms[0].items")).toBeNull();
    expect(formPathOf("rooms[1].items[0].id")).toBeNull();
    expect(formPathOf("")).toBeNull();
  });
});
