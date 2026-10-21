import type { Client } from "./generated/client";
import { client } from "./generated/client.gen";
import { zProblemDetails } from "./generated/zod.gen";
import type { ApiFailure } from "./problems";

// Configura o client gerado (o singleton que o SDK usa por padrão) e lê as falhas das chamadas.
// If-Match e Idempotency-Key não entram aqui: são da outbox (shared/sync/outbox.ts).

/** Quem fornece o access token. Ele vive só em memória; a sessão (M4) é quem chama `set`. */
export interface AccessTokenSource {
  get(): string | null;
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

export function configureClient(target: Client, { baseUrl, token, fetch }: ClientSettings): Client {
  target.setConfig({ baseUrl, ...(fetch && { fetch }) });
  target.interceptors.request.use((request) => {
    const value = token.get();
    if (value) request.headers.set("Authorization", `Bearer ${value}`);
    if (!new URL(request.url).pathname.startsWith(authPath)) return request;
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
