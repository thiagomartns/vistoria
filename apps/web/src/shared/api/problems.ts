import type { ProblemDetails, ProblemType } from "./generated";

// A reação a uma falha sai do `type` (tabela "Reação aos erros" do frontend.md), nunca do status HTTP:
// 409 e 412 compartilham version-conflict de propósito. Executar a reação é da outbox e da sessão (M2 a M4).

/**
 * Por que uma chamada falhou (lido por `readFailure`, em client.ts).
 * - `problem`: a API respondeu um ProblemDetails do contrato.
 * - `network`: sem resposta (o fetch lançou).
 * - `unreadable`: houve resposta, mas não é um ProblemDetails do contrato (por exemplo, o HTML de um 502 do proxy).
 */
export type ApiFailure =
  | { kind: "problem"; problem: ProblemDetails }
  | { kind: "network"; cause: unknown }
  | { kind: "unreadable"; status: number; body: unknown };

/** Um grupo da tabela "Reação aos erros". */
export type ReactionGroup =
  | "retry"
  | "renew-session"
  | "user-decision"
  | "accept-server"
  | "back-to-draft"
  | "discard-and-warn"
  | "bug"
  | "resync"
  | "remove-local"
  | "invalid-credentials";

export function handleProblem(failure: ApiFailure): ReactionGroup {
  switch (failure.kind) {
    case "network":
    case "unreadable":
      return "retry";
    case "problem":
      return reactionFor(failure.problem.type);
  }
}

// Sem default: um type novo no contrato deixa `type` sem estreitar para never e quebra o typecheck
// até ganhar um case aqui (e uma linha na tabela do frontend.md).
function reactionFor(type: ProblemType): ReactionGroup {
  switch (type) {
    case "urn:vistoria:problem:internal":
    case "urn:vistoria:problem:rate-limited":
    case "urn:vistoria:problem:idempotency-in-progress":
      return "retry";
    case "urn:vistoria:problem:unauthorized":
      return "renew-session";
    case "urn:vistoria:problem:version-conflict":
    case "urn:vistoria:problem:deleted":
      return "user-decision";
    case "urn:vistoria:problem:locked":
      return "accept-server";
    case "urn:vistoria:problem:validation":
      return "back-to-draft";
    case "urn:vistoria:problem:forbidden":
      return "discard-and-warn";
    case "urn:vistoria:problem:idempotency-key-reused":
    case "urn:vistoria:problem:precondition-required":
    case "urn:vistoria:problem:unsupported-request":
      return "bug";
    case "urn:vistoria:problem:cursor-expired":
    case "urn:vistoria:problem:invalid-cursor":
      return "resync";
    case "urn:vistoria:problem:not-found":
      return "remove-local";
    case "urn:vistoria:problem:invalid-credentials":
      return "invalid-credentials";
  }
  return unhandled(type);
}

function unhandled(type: never): never {
  throw new Error(`ProblemType sem reação: ${String(type)}`);
}
