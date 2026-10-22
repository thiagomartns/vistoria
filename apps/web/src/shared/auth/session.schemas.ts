import { z } from "zod";

import { zSignInDto, zSignUpDto } from "../api/generated/zod.gen";

// Os formulários de /login e /signup sobre o Zod gerado: os limites vêm do contrato. A UI soma o que o OpenAPI
// não expressa (campo vazio e formato do e-mail) e as mensagens, iguais às do .NET (AuthDtos.cs).

const email = (schema: z.ZodString) => schema.min(1).pipe(z.email());

export const signInSchema = zSignInDto.extend({
  email: email(zSignInDto.shape.email),
  password: zSignInDto.shape.password.min(1),
});

export const signUpSchema = zSignUpDto.extend({
  email: email(zSignUpDto.shape.email),
});

export type SignInValues = z.infer<typeof signInSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;

interface FieldMessages {
  required: string;
  length: string;
  format?: string;
}

const EMAIL: FieldMessages = {
  required: "Informe o e-mail.",
  length: "O e-mail pode ter até 254 caracteres.",
  format: "Informe um e-mail válido.",
};

/** Mensagem por campo e tipo de falha: vazio, tamanho ou formato. */
function messages(fields: Record<string, FieldMessages>): z.core.$ZodErrorMap {
  return (issue) => {
    const field = fields[String(issue.path?.[0])];
    if (!field) return undefined;
    if (issue.code === "invalid_format") return field.format;
    return issue.input === "" ? field.required : field.length;
  };
}

/** Para o `zodResolver(signInSchema, signInErrors)`. */
export const signInErrors = {
  error: messages({
    email: EMAIL,
    password: { required: "Informe a senha.", length: "A senha pode ter até 128 caracteres." },
  }),
};

/** Para o `zodResolver(signUpSchema, signUpErrors)`. */
export const signUpErrors = {
  error: messages({
    name: { required: "Informe o nome.", length: "O nome precisa ter de 2 a 120 caracteres." },
    email: EMAIL,
    password: {
      required: "Informe a senha.",
      length: "A senha precisa ter de 8 a 128 caracteres.",
    },
  }),
};
