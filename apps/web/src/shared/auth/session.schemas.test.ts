// @vitest-environment node

import { describe, expect, it } from "vitest";

import { signInErrors, signInSchema, signUpErrors, signUpSchema } from "./session.schemas";

// As mensagens são as do .NET (AuthDtos.cs); os limites vêm do Zod gerado.

const messagesOf = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path[0], issue.message]));

describe("signInSchema", () => {
  it("campos vazios pedem o e-mail e a senha", () => {
    const result = signInSchema.safeParse({ email: "", password: "" }, signInErrors);

    expect(messagesOf(result)).toEqual({
      email: "Informe o e-mail.",
      password: "Informe a senha.",
    });
  });

  it("e-mail sem formato, e o teto do contrato", () => {
    const result = signInSchema.safeParse(
      { email: "thiago", password: "x".repeat(129) },
      signInErrors,
    );

    expect(messagesOf(result)).toEqual({
      email: "Informe um e-mail válido.",
      password: "A senha pode ter até 128 caracteres.",
    });
  });

  it("aceita e-mail e senha válidos", () => {
    expect(signInSchema.safeParse({ email: "t@exemplo.com", password: "x" }).success).toBe(true);
  });
});

describe("signUpSchema", () => {
  it("campos vazios", () => {
    const result = signUpSchema.safeParse({ name: "", email: "", password: "" }, signUpErrors);

    expect(messagesOf(result)).toEqual({
      name: "Informe o nome.",
      email: "Informe o e-mail.",
      password: "Informe a senha.",
    });
  });

  it("tamanhos do contrato: nome de 2 a 120, senha de 8 a 128", () => {
    const result = signUpSchema.safeParse(
      { name: "T", email: "t@exemplo.com", password: "curta" },
      signUpErrors,
    );

    expect(messagesOf(result)).toEqual({
      name: "O nome precisa ter de 2 a 120 caracteres.",
      password: "A senha precisa ter de 8 a 128 caracteres.",
    });
  });
});
