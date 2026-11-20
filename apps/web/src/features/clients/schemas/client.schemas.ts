import { z } from "zod";

import { zUpsertClientDto } from "@/shared/api/generated/zod.gen";
import { digitsOf, fillPattern } from "@/shared/mask";

// O formulário de cliente sobre o Zod gerado: os limites vêm do contrato. A UI soma o que o OpenAPI não expressa
// (campo vazio vira null, formato do e-mail, dígitos verificadores do CPF/CNPJ, a regra do telefone) e as mensagens,
// iguais às do .NET (ClientDtos.cs, CpfCnpjAttribute.cs, TelefoneAttribute.cs). O .NET confere tudo de novo. O documento
// e o telefone são digitados com máscara e salvos sem ela (ADR 0063).

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

const CPF_PATTERN = "000.000.000-00";
const CNPJ_PATTERN = "00.000.000/0000-00";

/**
 * Máscara ao digitar: a de CPF enquanto só há dígitos e até 11 deles; a de CNPJ com uma letra (o alfanumérico) ou a
 * partir do 12º caractere. Letras em maiúsculas, no máximo 14 caracteres.
 */
export function maskDocument(raw: string): string {
  const chars = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 14);
  return fillPattern(chars, /^\d{0,11}$/.test(chars) ? CPF_PATTERN : CNPJ_PATTERN);
}

/** Máscara de exibição: 123.456.789-09 e 12.ABC.345/01DE-35. O que não for CPF nem CNPJ sai como está. */
export function formatDocument(value: string): string {
  if (/^\d{11}$/.test(value)) return value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (/^[0-9A-Z]{12}\d{2}$/.test(value)) {
    return value.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return value;
}

/** Os 67 DDDs do plano de numeração da Anatel, como no TelefoneAttribute. */
export const DDDS: ReadonlySet<string> = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38", "41", "42", "43", "44", "45", "46", "47",
  "48", "49", "51", "53", "54", "55", "61", "62", "63", "64", "65", "66", "67", "68",
  "69", "71", "73", "74", "75", "77", "79", "81", "82", "83", "84", "85", "86", "87",
  "88", "89", "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

/**
 * O telefone como a API guarda: só os dígitos, sem o 55 do país que sobra (12 ou 13 dígitos; o canônico tem no
 * máximo 11). Como a normalização do TelefoneAttribute.
 */
export function normalizePhone(value: string): string {
  const digits = digitsOf(value);
  return (digits.length === 12 || digits.length === 13) && digits.startsWith("55") ? digits.slice(2) : digits;
}

/** DDD válido e um fixo (10 dígitos, o número de 2 a 5) ou um celular (11, começando por 9). */
export function isPhone(value: string): boolean {
  if (!/^\d{10,11}$/.test(value) || !DDDS.has(value.slice(0, 2))) return false;
  return value.length === 10 ? /[2-5]/.test(value[2]!) : value[2] === "9";
}

const LANDLINE_PATTERN = "(00) 0000-0000";
const MOBILE_PATTERN = "(00) 00000-0000";

/**
 * Máscara ao digitar: (00) 0000-0000 até 10 dígitos e (00) 00000-0000 com 11. Com mais de 11 começando por 55 (o
 * +55 colado), o 55 sai, então colar com ou sem o país dá o mesmo.
 */
export function maskPhone(raw: string): string {
  let digits = digitsOf(raw);
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  return fillPattern(digits, digits.length <= 10 ? LANDLINE_PATTERN : MOBILE_PATTERN);
}

/** Máscara de exibição: (71) 3333-0000 e (71) 99999-0000. O que não tiver 10 ou 11 dígitos sai como está. */
export function formatPhone(value: string): string {
  return /^\d{10,11}$/.test(value) ? maskPhone(value) : value;
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
  phone: z
    .string()
    .transform((value) => (value.trim() === "" ? null : normalizePhone(value)))
    .pipe(z.string().refine(isPhone).nullable()),
});

/** O que o formulário edita: tudo texto, como nos inputs. */
export type ClientFormValues = z.input<typeof clientFormSchema>;
/** O que o formulário entrega ao salvar: vazio vira null, documento e telefone sem máscara. */
export type ClientFormOutput = z.output<typeof clientFormSchema>;

export const CLIENT_FIELDS = ["name", "document", "email", "phone"] as const;

const MESSAGES = {
  name: { required: "Informe o nome.", length: "O nome precisa ter de 2 a 120 caracteres." },
  document: { format: "Informe um CPF ou CNPJ válido." },
  email: { format: "Informe um e-mail válido.", length: "O e-mail pode ter até 254 caracteres." },
  phone: { format: "Informe o telefone com DDD: 10 dígitos (fixo) ou 11 (celular)." },
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
