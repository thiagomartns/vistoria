import { type ApiFailure, handleProblem } from "../api/problems";

// Do que o signin ou o signup devolveu para o que o formulário mostra. A reação sai do `type` (handleProblem);
// o status HTTP nunca entra aqui.

export interface AuthFailureView {
  /** Mensagens da API por campo do formulário (`validation`). */
  fields: Partial<Record<string, string>>;
  /** Mensagem do formulário inteiro, num Alert acima dos campos. */
  form: string | null;
}

export const INVALID_CREDENTIALS = "E-mail ou senha incorretos.";
export const NO_CONNECTION = "Sem conexão. Confira a internet e tente de novo.";
export const RATE_LIMITED = "Muitas tentativas. Tente novamente em alguns minutos.";

/**
 * @param fieldNames campos do formulário que recebem a mensagem da API no próprio campo.
 * @param fallback mensagem para o que não tem reação própria ("Não foi possível entrar agora...").
 */
export function readAuthFailure(
  failure: ApiFailure,
  fieldNames: readonly string[],
  fallback: string,
): AuthFailureView {
  switch (handleProblem(failure)) {
    case "invalid-credentials":
      return { fields: {}, form: INVALID_CREDENTIALS };
    case "back-to-draft": {
      const errors = failure.kind === "problem" ? (failure.problem.errors ?? {}) : {};
      const fields: AuthFailureView["fields"] = {};
      const rest: string[] = [];
      for (const [key, messages] of Object.entries(errors)) {
        if (fieldNames.includes(key)) fields[key] = messages[0];
        else rest.push(...messages);
      }
      const form =
        rest.length > 0 ? rest.join(" ") : Object.keys(fields).length > 0 ? null : fallback;
      return { fields, form };
    }
    case "retry":
      if (failure.kind === "network") return { fields: {}, form: NO_CONNECTION };
      if (
        failure.kind === "problem" &&
        failure.problem.type === "urn:vistoria:problem:rate-limited"
      ) {
        return { fields: {}, form: RATE_LIMITED };
      }
      return { fields: {}, form: fallback };
    default:
      return { fields: {}, form: fallback };
  }
}
