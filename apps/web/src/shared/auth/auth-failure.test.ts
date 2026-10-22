// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ApiFailure } from "../api/problems";
import { readAuthFailure } from "./auth-failure";

const problem = (type: string, status: number, errors?: Record<string, string[]>): ApiFailure => ({
  kind: "problem",
  problem: {
    type: `urn:vistoria:problem:${type}` as never,
    title: type,
    status,
    detail: type,
    traceId: "00-trace",
    errors,
  },
});

const fields = ["name", "email", "password"];
const read = (failure: ApiFailure) => readAuthFailure(failure, fields, "Não foi possível agora.");

describe("readAuthFailure", () => {
  it("invalid-credentials → mensagem do formulário, sem campo", () => {
    expect(read(problem("invalid-credentials", 401))).toEqual({
      fields: {},
      form: "E-mail ou senha incorretos.",
    });
  });

  it("validation → a mensagem da API no campo; chave sem campo vai para o formulário", () => {
    expect(read(problem("validation", 400, { email: ["E-mail já cadastrado."] }))).toEqual({
      fields: { email: "E-mail já cadastrado." },
      form: null,
    });
    expect(read(problem("validation", 400, { "": ["Corpo inválido."] }))).toEqual({
      fields: {},
      form: "Corpo inválido.",
    });
  });

  it("rede, rate-limited e o resto", () => {
    expect(read({ kind: "network", cause: null }).form).toBe(
      "Sem conexão. Confira a internet e tente de novo.",
    );
    expect(read(problem("rate-limited", 429)).form).toBe(
      "Muitas tentativas. Tente novamente em alguns minutos.",
    );
    expect(read(problem("internal", 500)).form).toBe("Não foi possível agora.");
    expect(read({ kind: "unreadable", status: 502, body: "<html>" }).form).toBe(
      "Não foi possível agora.",
    );
  });
});
