// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type ClientFormValues,
  clientErrors,
  clientFormSchema,
  formatDocument,
  isCpfOrCnpj,
  stripDocument,
} from "./client.schemas";

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

describe("clientFormSchema", () => {
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
    ["phone", { phone: "9".repeat(21) }, "O telefone pode ter até 20 caracteres."],
  ])("%s: %j → %s", (field, values, message) => {
    expect(messageOf(values, field)).toBe(message);
  });
});
