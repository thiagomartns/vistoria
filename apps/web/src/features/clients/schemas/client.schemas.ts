import { z } from "zod";

import { zUpsertClientDto } from "@/shared/api/generated/zod.gen";

// O formulário de cliente sobre o Zod gerado: os limites vêm do contrato. A UI soma o que o OpenAPI não expressa
// (campo vazio vira null, formato do e-mail, dígitos verificadores do CPF/CNPJ) e as mensagens, iguais às do .NET
// (ClientDtos.cs, CpfCnpjAttribute.cs). O .NET confere tudo de novo.

const CPF_WEIGHTS = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

// Módulo 11 nos dois verificadores, como no CpfCnpjAttribute: cada caractere vale o código ASCII menos 48, então
// as letras do CNPJ alfanumérico entram no mesmo cálculo.
function checkDigitsMatch(value: string, weights: number[]): boolean {
  for (let position = value.length - 2; position < value.length; position++) {
    const offset = weights.length - position;
    let sum = 0;
    for (let i = 0; i < position; i++) sum += (value.charCodeAt(i) - 48) * weights[offset + i]!;
    const remainder = sum % 11;
    if (value.charCodeAt(position) - 48 !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}

// 111.111.111-11 e afins passam no cálculo, mas não são documentos.
const allSame = (value: string) => [...value].every((char) => char === value[0]);

/** CPF (11 dígitos) ou CNPJ (14, alfanumérico nas 12 primeiras posições), sem máscara e com os verificadores. */
export function isCpfOrCnpj(value: string): boolean {
  if (allSame(value)) return false;
  if (/^\d{11}$/.test(value)) return checkDigitsMatch(value, CPF_WEIGHTS);
  if (/^[0-9A-Z]{12}\d{2}$/.test(value)) return checkDigitsMatch(value, CNPJ_WEIGHTS);
  return false;
}

/** O documento como a API guarda: sem pontos, traço, barra e espaços, em maiúsculas. */
export function stripDocument(value: string): string {
  return value.replace(/[.\-/\s]/g, "").toUpperCase();
}

/** Máscara de exibição: 123.456.789-09 e 12.ABC.345/01DE-35. O que não for CPF nem CNPJ sai como está. */
export function formatDocument(value: string): string {
  if (/^\d{11}$/.test(value)) return value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (/^[0-9A-Z]{12}\d{2}$/.test(value)) {
    return value.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return value;
}

const blankToNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export const clientFormSchema = z.object({
  name: z.string().trim().pipe(zUpsertClientDto.shape.name),
  document: z
    .string()
    .transform((value) => blankToNull(stripDocument(value)))
    .pipe(z.string().refine(isCpfOrCnpj).nullable()),
  email: z
    .string()
    .transform(blankToNull)
    .pipe(zUpsertClientDto.shape.email.unwrap().unwrap().pipe(z.email()).nullable()),
  phone: z.string().transform(blankToNull).pipe(zUpsertClientDto.shape.phone.unwrap().unwrap().nullable()),
});

/** O que o formulário edita: tudo texto, como nos inputs. */
export type ClientFormValues = z.input<typeof clientFormSchema>;
/** O que o formulário entrega ao salvar: vazio vira null, documento sem máscara. */
export type ClientFormOutput = z.output<typeof clientFormSchema>;

export const CLIENT_FIELDS = ["name", "document", "email", "phone"] as const;

const MESSAGES = {
  name: { required: "Informe o nome.", length: "O nome precisa ter de 2 a 120 caracteres." },
  document: { format: "Informe um CPF ou CNPJ válido." },
  email: { format: "Informe um e-mail válido.", length: "O e-mail pode ter até 254 caracteres." },
  phone: { length: "O telefone pode ter até 20 caracteres." },
} satisfies Record<(typeof CLIENT_FIELDS)[number], { required?: string; length?: string; format?: string }>;

/** Para o `zodResolver(clientFormSchema, clientErrors)`. */
export const clientErrors: { error: z.core.$ZodErrorMap } = {
  error: (issue) => {
    const field = MESSAGES[String(issue.path?.[0]) as keyof typeof MESSAGES] as
      | { required?: string; length?: string; format?: string }
      | undefined;
    if (!field) return undefined;
    if (issue.code === "too_small" && issue.input === "") return field.required;
    if (issue.code === "too_small" || issue.code === "too_big") return field.length;
    return field.format;
  },
};
