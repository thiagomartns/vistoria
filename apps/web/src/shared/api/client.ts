import type { Client } from "./generated/client";
import { client } from "./generated/client.gen";
import { zProblemDetails } from "./generated/zod.gen";
import { type ApiFailure, handleProblem } from "./problems";

// Configura o client gerado (o singleton que o SDK usa por padrão) e lê as falhas das chamadas.
// If-Match e Idempotency-Key não entram aqui: são da outbox (shared/sync/outbox.ts). Um `unauthorized` renova a sessão
// e reenvia a mesma requisição, com os mesmos cabeçalhos e corpo (ADR 0045).

/**
 * Como terminou a renovação pedida por um `unauthorized`: `renewed` (há token novo), `expired` (o refresh foi recusado:
 * sessão expirada) ou `offline` (o refresh ficou sem resposta: tenta de novo depois, sem expirar).
 */
export type RenewOutcome = "renewed" | "expired" | "offline";

/** Quem fornece o access token. Ele vive só em memória; a sessão é quem chama `set` e registra o `renew`. */
export interface AccessTokenSource {
  get(): string | null;
  /** Renova depois de um `unauthorized`. Sem ele, o 401 volta para quem chamou. */
  renew?: () => Promise<RenewOutcome>;
}

let currentToken: string | null = null;

export const accessToken: AccessTokenSource & { set(token: string | null): void } = {
  get: () => currentToken,
  set: (token) => {
    currentToken = token;
  },
};

// O refresh token é um cookie HttpOnly com Path=/api/v1/auth; em dev, front e API estão em portas diferentes,
// então o navegador só o envia (e aceita o novo) com credentials: "include".
const authPath = "/api/v1/auth/";

export interface ClientSettings {
  baseUrl: string;
  token: AccessTokenSource;
  fetch?: typeof fetch;
}

const isAuthPath = (url: string) => new URL(url).pathname.startsWith(authPath);

/** A resposta é o `unauthorized` do contrato (pelo `type`, nunca pelo status). */
async function isUnauthorized(response: Response): Promise<boolean> {
  if (response.ok) return false;
  const parsed = zProblemDetails.safeParse(
    await response
      .clone()
      .json()
      .catch(() => null),
  );
  return (
    parsed.success && handleProblem({ kind: "problem", problem: parsed.data }) === "renew-session"
  );
}

/**
 * Envolve o `fetch`: um `unauthorized` fora de `/auth/*` renova a sessão e reenvia a requisição uma vez, com o token
 * novo. Quem chamou (a outbox, o pull, o `GET` por id) espera a renovação e recebe a resposta do reenvio; a outbox é
 * serial, então a fila fica parada e retoma a mesma transação, com a mesma `Idempotency-Key`. Se outra chamada já
 * renovou, reenvia sem pedir outro refresh. O refresh sem resposta vira falha de rede: tenta de novo, sem expirar.
 */
function renewingOnUnauthorized(
  send: (request: Request) => Promise<Response>,
  token: AccessTokenSource,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (isAuthPath(request.url)) return send(request);
    const replay = request.clone();
    const sentWith = request.headers.get("Authorization");
    const response = await send(request);
    if (!(await isUnauthorized(response))) return response;
    const before = token.get();
    if (!before || `Bearer ${before}` === sentWith) {
      const outcome = (await token.renew?.()) ?? "expired";
      if (outcome === "expired") return response;
      if (outcome === "offline") throw new TypeError("Refresh sem resposta");
    }
    const fresh = token.get();
    if (!fresh) return response;
    replay.headers.set("Authorization", `Bearer ${fresh}`);
    return send(replay);
  };
}

export function configureClient(target: Client, { baseUrl, token, fetch }: ClientSettings): Client {
  // Sem `fetch` próprio, o global é lido a cada chamada, como o client gerado faria.
  const send = fetch ?? ((request: Request) => globalThis.fetch(request));
  target.setConfig({
    baseUrl,
    fetch: renewingOnUnauthorized(send, token) as typeof globalThis.fetch,
  });
  target.interceptors.request.use((request) => {
    const value = token.get();
    if (value) request.headers.set("Authorization", `Bearer ${value}`);
    if (!isAuthPath(request.url)) return request;
    return new Request(request, { credentials: "include" });
  });
  return target;
}

// Em produção o front é servido na mesma origem da API (URL relativa); em dev, a API está na porta 8080.
const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8080" : "");

configureClient(client, { baseUrl: apiBaseUrl, token: accessToken });

/** Lê o `{ error, response }` de uma chamada do SDK que falhou. */
export function readFailure({
  error,
  response,
}: {
  error: unknown;
  response?: Response;
}): ApiFailure {
  if (!response) return { kind: "network", cause: error };
  const parsed = zProblemDetails.safeParse(error);
  if (parsed.success) return { kind: "problem", problem: parsed.data };
  return { kind: "unreadable", status: response.status, body: error };
}
