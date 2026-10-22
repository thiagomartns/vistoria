// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  type PropertyFormValues,
  UFS,
  formatZipCode,
  propertyErrors,
  propertyFormSchema,
  stripZipCode,
} from "./property.schemas";

// O schema do formulário de imóvel: o que sai para o PUT e as mensagens, iguais às do .NET (PropertyDtos.cs).

const valid: PropertyFormValues = {
  clientId: "01a16032-2dfb-77de-84a2-1f165bdd993e",
  type: "apartment",
  zipCode: "01400-000",
  street: "Rua das Flores",
  number: "120",
  complement: "ap 32",
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "sp",
  notes: "",
};

const parse = (over: Partial<PropertyFormValues> = {}) =>
  propertyFormSchema.safeParse({ ...valid, ...over }, propertyErrors);

const messages = (over: Partial<PropertyFormValues>) => {
  const result = parse(over);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
};

describe("propertyFormSchema", () => {
  it("sai no formato da API: CEP sem hífen, UF em maiúsculas, vazio vira null", () => {
    expect(parse().data).toEqual({
      ...valid,
      zipCode: "01400000",
      state: "SP",
      notes: null,
    });
    expect(parse({ complement: "  ", notes: " Portaria 24h. " }).data).toMatchObject({
      complement: null,
      notes: "Portaria 24h.",
    });
  });

  it("o .NET tem as mesmas 27 UFs", () => {
    expect(UFS).toHaveLength(27);
    expect(parse({ state: " df " }).data?.state).toBe("DF");
  });

  it("obrigatórios vazios: a mensagem de cada campo", () => {
    expect(
      messages({
        clientId: "",
        type: "",
        zipCode: "",
        street: " ",
        number: "",
        district: "",
        city: "",
        state: "",
      }),
    ).toEqual({
      clientId: "Informe o cliente.",
      type: "Informe o tipo do imóvel.",
      zipCode: "Informe o CEP.",
      street: "Informe a rua.",
      number: "Informe o número (ou s/n).",
      district: "Informe o bairro.",
      city: "Informe a cidade.",
      state: "Informe a UF.",
    });
  });

  it("formato: UF que não existe, CEP sem 8 dígitos", () => {
    expect(messages({ state: "XX", zipCode: "0140-000" })).toEqual({
      state: "Informe a sigla de uma UF.",
      zipCode: "Informe o CEP com 8 dígitos.",
    });
    expect(messages({ zipCode: "0140O000" })).toEqual({ zipCode: "Informe o CEP com 8 dígitos." });
  });

  it("tamanhos do contrato", () => {
    expect(
      messages({
        street: "r".repeat(121),
        number: "1".repeat(11),
        complement: "c".repeat(61),
        district: "b".repeat(61),
        city: "c".repeat(61),
        notes: "n".repeat(1001),
      }),
    ).toEqual({
      street: "A rua pode ter até 120 caracteres.",
      number: "O número pode ter até 10 caracteres.",
      complement: "O complemento pode ter até 60 caracteres.",
      district: "O bairro pode ter até 60 caracteres.",
      city: "A cidade pode ter até 60 caracteres.",
      notes: "As observações podem ter até 1000 caracteres.",
    });
  });

  it("aceita 's/n' no número", () => {
    expect(parse({ number: "s/n" }).success).toBe(true);
  });
});

describe("CEP", () => {
  it("stripZipCode tira hífen, ponto e espaços; formatZipCode põe o hífen de volta", () => {
    expect(stripZipCode(" 01.400-000 ")).toBe("01400000");
    expect(formatZipCode("01400000")).toBe("01400-000");
    expect(formatZipCode("0140")).toBe("0140");
  });
});
