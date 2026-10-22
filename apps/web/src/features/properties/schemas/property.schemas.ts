import { z } from "zod";

import { zPropertyType, zUpsertPropertyDto } from "@/shared/api/generated/zod.gen";

import type { PropertyType } from "../models/property";

// O formulário de imóvel sobre o Zod gerado: os limites vêm do contrato. A UI soma o que o OpenAPI não expressa
// (obrigatórios, as 27 UFs, campo vazio vira null) e aceita o que a pessoa digita naturalmente: UF em minúsculas e
// CEP com hífen saem no formato da API. As mensagens são as do .NET (PropertyDtos.cs, UfAttribute.cs), menos as do
// CEP e da UF, que não pedem "sem hífen" nem "em maiúsculas" porque a UI já ajusta. O .NET confere tudo de novo.

/** As 27 siglas, como no UfAttribute. */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** O rótulo de cada `type`, na ordem do Select. */
export const PROPERTY_TYPES = {
  apartment: "Apartamento",
  house: "Casa",
  commercial: "Comercial",
  other: "Outro",
} as const satisfies Record<PropertyType, string>;

/** As opções dos Select de tipo. */
export const TYPE_OPTIONS = (Object.entries(PROPERTY_TYPES) as [PropertyType, string][]).map(
  ([value, label]) => ({ value, label }),
);

/** O CEP como a API guarda: sem hífen, ponto e espaços. */
export function stripZipCode(value: string): string {
  return value.replace(/[.\-\s]/g, "");
}

/** Máscara de exibição: 01400-000. O que não tiver 8 dígitos sai como está. */
export function formatZipCode(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
}

const blankToNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const shape = zUpsertPropertyDto.shape;
const required = (schema: z.ZodString) => z.string().trim().pipe(schema.min(1));

export const propertyFormSchema = z.object({
  clientId: z.string().pipe(shape.clientId.unwrap()),
  type: z.string().pipe(zPropertyType),
  zipCode: z.string().transform(stripZipCode).pipe(shape.zipCode),
  street: required(shape.street),
  number: required(shape.number),
  complement: z.string().transform(blankToNull).pipe(shape.complement.unwrap().unwrap().nullable()),
  district: required(shape.district),
  city: required(shape.city),
  state: z.string().trim().toUpperCase().pipe(z.enum(UFS)),
  notes: z.string().transform(blankToNull).pipe(shape.notes.unwrap().unwrap().nullable()),
});

/** O que o formulário edita: tudo texto, como nos inputs e nos Select. */
export type PropertyFormValues = z.input<typeof propertyFormSchema>;
/** O que o formulário entrega ao salvar: vazio vira null, CEP sem hífen, UF em maiúsculas. */
export type PropertyFormOutput = z.output<typeof propertyFormSchema>;

export const PROPERTY_FIELDS = [
  "clientId",
  "type",
  "zipCode",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
  "notes",
] as const;

type Messages = { required?: string; length?: string; format?: string };

const MESSAGES = {
  clientId: { required: "Informe o cliente.", format: "Informe o cliente." },
  type: { required: "Informe o tipo do imóvel.", format: "Informe o tipo do imóvel." },
  zipCode: { required: "Informe o CEP.", format: "Informe o CEP com 8 dígitos." },
  street: { required: "Informe a rua.", length: "A rua pode ter até 120 caracteres." },
  number: { required: "Informe o número (ou s/n).", length: "O número pode ter até 10 caracteres." },
  complement: { length: "O complemento pode ter até 60 caracteres." },
  district: { required: "Informe o bairro.", length: "O bairro pode ter até 60 caracteres." },
  city: { required: "Informe a cidade.", length: "A cidade pode ter até 60 caracteres." },
  state: { required: "Informe a UF.", format: "Informe a sigla de uma UF." },
  notes: { length: "As observações podem ter até 1000 caracteres." },
} satisfies Record<(typeof PROPERTY_FIELDS)[number], Messages>;

/** Para o `zodResolver(propertyFormSchema, propertyErrors)`. */
export const propertyErrors: { error: z.core.$ZodErrorMap } = {
  error: (issue) => {
    const field = MESSAGES[String(issue.path?.[0]) as keyof typeof MESSAGES] as Messages | undefined;
    if (!field) return undefined;
    if (issue.input === "" && field.required) return field.required;
    if (issue.code === "too_small" || issue.code === "too_big") return field.length;
    return field.format;
  },
};
