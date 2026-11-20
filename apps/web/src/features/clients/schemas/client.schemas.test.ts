// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type ClientFormValues,
  clientErrors,
  clientFormSchema,
  formatDocument,
  formatPhone,
  isCpfOrCnpj,
  isPhone,
  maskDocument,
  maskPhone,
  normalizePhone,
  stripDocument,
} from "./client.schemas";

/** O valor a cada tecla, como o MaskedInput o recebe: o mascarado de antes com o caractere novo no fim. */
function typed(mask: (raw: string) => string, keys: string): string[] {
  const steps: string[] = [];
  let value = "";
  for (const key of keys) {
    value = mask(value + key);
    steps.push(value);
  }
  return steps;
}

const empty: ClientFormValues = { name: "Maria Souza", document: "", email: "", phone: "" };

function parse(values: Partial<ClientFormValues>) {
  return clientFormSchema.safeParse({ ...empty, ...values }, clientErrors);
}

function messageOf(values: Partial<ClientFormValues>, field: string) {
  const result = parse(values);
  if (result.success) return undefined;
  return z.flattenError(result.error).fieldErrors[field as keyof ClientFormValues]?.[0];
}

describe("isCpfOrCnpj (o mesmo cálculo do CpfCnpjAttribute)", () => {
  it.each([
    ["CPF", "52998224725"],
    ["CNPJ numérico", "11222333000181"],
    ["CNPJ alfanumérico", "12ABC34501DE35"],
  ])("aceita %s válido", (_, value) => {
    expect(isCpfOrCnpj(value)).toBe(true);
  });

  it.each([
    ["CPF com verificador errado", "52998224724"],
    ["CNPJ com verificador errado", "11222333000182"],
    ["todos iguais", "11111111111"],
    ["tamanho errado", "5299822472"],
    ["letra nos verificadores", "12ABC34501DE3A"],
    ["letra minúscula", "12abc34501de35"],
  ])("recusa %s", (_, value) => {
    expect(isCpfOrCnpj(value)).toBe(false);
  });
});

describe("máscara", () => {
  it("tira a máscara e põe em maiúsculas", () => {
    expect(stripDocument("529.982.247-25")).toBe("52998224725");
    expect(stripDocument("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("formata CPF e CNPJ para exibir; o resto sai como está", () => {
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatDocument("123")).toBe("123");
  });
});

describe("maskDocument (ao digitar)", () => {
  it("CPF caractere a caractere", () => {
    expect(typed(maskDocument, "52998224725")).toEqual([
      "5",
      "52",
      "529",
      "529.9",
      "529.98",
      "529.982",
      "529.982.2",
      "529.982.24",
      "529.982.247",
      "529.982.247-2",
      "529.982.247-25",
    ]);
  });

  it("passa para o CNPJ no 12º caractere", () => {
    expect(typed(maskDocument, "11222333000181").slice(10)).toEqual([
      "112.223.330-00",
      "11.222.333/0001",
      "11.222.333/0001-8",
      "11.222.333/0001-81",
    ]);
  });

  it("o CNPJ alfanumérico: a letra já escolhe o CNPJ, em maiúsculas", () => {
    expect(typed(maskDocument, "12abc34501de35")).toEqual([
      "1",
      "12",
      "12.A",
      "12.AB",
      "12.ABC",
      "12.ABC.3",
      "12.ABC.34",
      "12.ABC.345",
      "12.ABC.345/0",
      "12.ABC.345/01",
      "12.ABC.345/01D",
      "12.ABC.345/01DE",
      "12.ABC.345/01DE-3",
      "12.ABC.345/01DE-35",
    ]);
  });

  it.each([
    ["CPF sem máscara", "52998224725", "529.982.247-25"],
    ["CPF com máscara", "529.982.247-25", "529.982.247-25"],
    ["CNPJ com máscara", "11.222.333/0001-81", "11.222.333/0001-81"],
    ["CNPJ alfanumérico em minúsculas", "12.abc.345/01de-35", "12.ABC.345/01DE-35"],
    ["com espaços e sobrando", " 11 222 333 0001 81 99", "11.222.333/0001-81"],
  ])("colar %s", (_, pasted, masked) => {
    expect(maskDocument(pasted)).toBe(masked);
  });
});

describe("telefone", () => {
  it("fixo caractere a caractere", () => {
    expect(typed(maskPhone, "7133330000")).toEqual([
      "(7",
      "(71",
      "(71) 3",
      "(71) 33",
      "(71) 333",
      "(71) 3333",
      "(71) 3333-0",
      "(71) 3333-00",
      "(71) 3333-000",
      "(71) 3333-0000",
    ]);
  });

  it("celular: o 11º dígito muda a máscara", () => {
    expect(typed(maskPhone, "71999990000").slice(9)).toEqual(["(71) 9999-9000", "(71) 99999-0000"]);
  });

  it("um 12º dígito não entra", () => {
    expect(maskPhone("(71) 99999-00001")).toBe("(71) 99999-0000");
  });

  it.each([
    ["sem máscara", "71999990000", "(71) 99999-0000"],
    ["com máscara", "(71) 99999-0000", "(71) 99999-0000"],
    ["com o +55", "+55 71 99999-0000", "(71) 99999-0000"],
    ["com o +55 e parênteses", "+55 (71) 3333-0000", "(71) 3333-0000"],
    ["com pontos", "71.3333.0000", "(71) 3333-0000"],
  ])("colar %s", (_, pasted, masked) => {
    expect(maskPhone(pasted)).toBe(masked);
  });

  it("normaliza como a API: só dígitos, sem o 55 que sobra", () => {
    expect(normalizePhone("(71) 3333-0000")).toBe("7133330000");
    expect(normalizePhone("+55 71 99999-0000")).toBe("71999990000");
    expect(normalizePhone("5571999990000")).toBe("71999990000");
    expect(normalizePhone("(55) 99999-0000")).toBe("55999990000");
    expect(normalizePhone("ramal")).toBe("");
  });

  it.each(["7133330000", "1125550000", "71999990000", "55999990000"])("aceita %s", (value) => {
    expect(isPhone(value)).toBe(true);
  });

  it.each([
    ["sem DDD", "33330000"],
    ["DDD que não existe", "1033330000"],
    ["fixo começando por 6", "7163330000"],
    ["10 dígitos começando por 9", "7199990000"],
    ["11 dígitos sem o 9", "71833330000"],
    ["12 dígitos", "719999900001"],
    ["com máscara", "(71) 3333-0000"],
  ])("recusa %s", (_, value) => {
    expect(isPhone(value)).toBe(false);
  });

  it("formata o canônico para exibir; o de antes da regra sai como está", () => {
    expect(formatPhone("7133330000")).toBe("(71) 3333-0000");
    expect(formatPhone("71999990000")).toBe("(71) 99999-0000");
    expect(formatPhone("+1 415 555 0100")).toBe("+1 415 555 0100");
    expect(formatPhone("(71) 3333-0000")).toBe("(71) 3333-0000");
  });
});

describe("clientFormSchema", () => {
  it("telefone sai só com dígitos, com ou sem a máscara e o +55", () => {
    expect(parse({ phone: "(71) 99999-0000" }).data?.phone).toBe("71999990000");
    expect(parse({ phone: "+55 71 3333-0000" }).data?.phone).toBe("7133330000");
    expect(parse({ phone: "  " }).data?.phone).toBeNull();
  });

  it("campo vazio vira null; documento sai sem máscara", () => {
    expect(parse({ document: "529.982.247-25" })).toEqual({
      success: true,
      data: { name: "Maria Souza", document: "52998224725", email: null, phone: null },
    });
    expect(parse({ email: "  " }).data?.email).toBeNull();
  });

  it.each([
    ["name", { name: "" }, "Informe o nome."],
    ["name", { name: "   " }, "Informe o nome."],
    ["name", { name: "M" }, "O nome precisa ter de 2 a 120 caracteres."],
    ["name", { name: "M".repeat(121) }, "O nome precisa ter de 2 a 120 caracteres."],
    ["document", { document: "529.982.247-24" }, "Informe um CPF ou CNPJ válido."],
    ["email", { email: "maria" }, "Informe um e-mail válido."],
    ["email", { email: `${"m".repeat(250)}@x.com` }, "O e-mail pode ter até 254 caracteres."],
    ["phone", { phone: "(71) 9999-0000" }, "Informe o telefone com DDD: 10 dígitos (fixo) ou 11 (celular)."],
    ["phone", { phone: "ramal 12" }, "Informe o telefone com DDD: 10 dígitos (fixo) ou 11 (celular)."],
    ["phone", { phone: "+1 415 555 0100" }, "Informe o telefone com DDD: 10 dígitos (fixo) ou 11 (celular)."],
  ])("%s: %j → %s", (field, values, message) => {
    expect(messageOf(values, field)).toBe(message);
  });
});
