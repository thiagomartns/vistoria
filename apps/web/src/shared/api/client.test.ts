// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { type AccessTokenSource, type RenewOutcome, configureClient, readFailure } from "./client";
import { getClient, refreshToken, signIn, upsertClient } from "./generated";
import { createClient, createConfig } from "./generated/client";

// Um client novo por teste, com um fetch falso que guarda o Request enviado.

const baseUrl = "http://api.test";
const id = "0199a1b2-0000-7000-8000-000000000001";
const credentials = { email: "ana@exemplo.com", password: "senha-forte" };

function setup(
  token: AccessTokenSource["get"],
  respond: () => Response | Promise<Response> = () => Response.json({}),
) {
  const requests: Request[] = [];
  const client = configureClient(createClient(createConfig()), {
    baseUrl,
    token: { get: token },
    fetch: async (input) => {
      requests.push(input as Request);
      return respond();
    },
  });
  return { client, requests };
}

const problemDetails = {
  type: "urn:vistoria:problem:version-conflict",
  title: "Conflito de versão",
  status: 409,
  detail: "O registro mudou.",
  traceId: "00-trace",
  current: { id },
};

describe("configureClient", () => {
  it("põe Authorization em toda chamada, inclusive em /auth/*", async () => {
    const { client, requests } = setup(() => "t0k3n");
    await getClient({ client, path: { id } });
    await signIn({ client, body: credentials });

    expect(requests.map((r) => r.headers.get("Authorization"))).toEqual([
      "Bearer t0k3n",
      "Bearer t0k3n",
    ]);
  });

  it("sem token, não manda Authorization", async () => {
    const { client, requests } = setup(() => null);
    await getClient({ client, path: { id } });

    expect(requests[0]?.headers.has("Authorization")).toBe(false);
  });

  it("lê o token a cada chamada", async () => {
    let token = "a";
    const { client, requests } = setup(() => token);
    await getClient({ client, path: { id } });
    token = "b";
    await getClient({ client, path: { id } });

    expect(requests.map((r) => r.headers.get("Authorization"))).toEqual(["Bearer a", "Bearer b"]);
  });

  it("credentials: include só em /auth/*", async () => {
    const { client, requests } = setup(() => "t0k3n");
    await signIn({ client, body: credentials });
    await getClient({ client, path: { id } });

    const [auth, other] = requests;
    expect(auth?.credentials).toBe("include");
    expect(other?.credentials).not.toBe("include");
  });

  it("mantém URL, método, cabeçalhos e corpo ao ligar credentials", async () => {
    const { client, requests } = setup(() => null);
    await signIn({ client, body: credentials });

    const request = requests[0]!;
    expect(request.url).toBe(`${baseUrl}/api/v1/auth/signin`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(await request.json()).toEqual(credentials);
  });

  it("monta a URL com a baseUrl", async () => {
    const { client, requests } = setup(() => null);
    await getClient({ client, path: { id } });

    expect(requests[0]?.url).toBe(`${baseUrl}/api/v1/clients/${id}`);
  });
});

describe("readFailure", () => {
  it("ProblemDetails do contrato → problem", async () => {
    const { client } = setup(
      () => null,
      () =>
        Response.json(problemDetails, {
          status: 409,
          headers: { "Content-Type": "application/problem+json" },
        }),
    );
    const result = await getClient({ client, path: { id } });

    expect(readFailure(result)).toEqual({ kind: "problem", problem: problemDetails });
  });

  it("410 deleted com o deletedAt como a API serializa (com fuso, não com Z) → problem", async () => {
    // O corpo real do PUT numa vistoria excluída: o DateTimeOffset do .NET sai com "+00:00" e 7 casas.
    const deleted = {
      type: "urn:vistoria:problem:deleted",
      title: "Registro excluído",
      status: 410,
      detail: "O registro foi excluído.",
      deletedAt: "2026-10-28T20:37:57.9603612+00:00",
      traceId: "00-trace",
    };
    const { client } = setup(
      () => null,
      () =>
        Response.json(deleted, {
          status: 410,
          headers: { "Content-Type": "application/problem+json" },
        }),
    );
    const result = await getClient({ client, path: { id } });

    expect(readFailure(result)).toEqual({ kind: "problem", problem: deleted });
  });

  it("fetch que lança → network", async () => {
    const cause = new TypeError("fetch failed");
    const { client } = setup(
      () => null,
      () => Promise.reject(cause),
    );
    const result = await getClient({ client, path: { id } });

    expect(readFailure(result)).toEqual({ kind: "network", cause });
  });

  it("HTML de um 502 do proxy → unreadable", async () => {
    const { client } = setup(
      () => null,
      () => new Response("<html>Bad Gateway</html>", { status: 502 }),
    );
    const result = await getClient({ client, path: { id } });

    expect(readFailure(result)).toEqual({
      kind: "unreadable",
      status: 502,
      body: "<html>Bad Gateway</html>",
    });
  });

  it("type fora do catálogo → unreadable", async () => {
    const body = { ...problemDetails, type: "urn:vistoria:problem:desconhecido" };
    const { client } = setup(
      () => null,
      () => Response.json(body, { status: 409 }),
    );
    const result = await getClient({ client, path: { id } });

    expect(readFailure(result)).toEqual({ kind: "unreadable", status: 409, body });
  });
});

describe("unauthorized: renova e reenvia a mesma requisição (ADR 0045)", () => {
  const unauthorized = () =>
    Response.json(
      {
        type: "urn:vistoria:problem:unauthorized",
        title: "Não autenticado",
        status: 401,
        detail: "Token expirado.",
        traceId: "00-trace",
      },
      { status: 401, headers: { "Content-Type": "application/problem+json" } },
    );
  const saved = () => Response.json({ id, name: "Ana", version: "AAAAAAAAB9M=" }, { status: 200 });

  /** Um client com o token em `state.token` e um `renew` que troca o token e devolve `outcome`. */
  function renewing(responses: (() => Response)[], outcome: RenewOutcome = "renewed") {
    const state = { token: "velho" as string | null };
    const renew = vi.fn<() => Promise<RenewOutcome>>(async () => {
      if (outcome === "renewed") state.token = "novo";
      if (outcome === "expired") state.token = null;
      return outcome;
    });
    const requests: Request[] = [];
    const client = configureClient(createClient(createConfig()), {
      baseUrl,
      token: { get: () => state.token, renew },
      fetch: async (input) => {
        requests.push(input as Request);
        return (responses.shift() ?? saved)();
      },
    });
    return { client, requests, renew, state };
  }

  const put = (client: ReturnType<typeof renewing>["client"]) =>
    upsertClient({
      client,
      path: { id },
      body: { name: "Ana" },
      headers: { "Idempotency-Key": "0199a1b2-0000-7000-8000-00000000000a", "If-Match": '"AAAA"' },
    });

  it("PUT → 401 unauthorized → refresh → o mesmo PUT, com a mesma chave, o mesmo If-Match e o mesmo corpo", async () => {
    const { client, requests, renew } = renewing([unauthorized]);

    const result = await put(client);

    expect(result.data).toMatchObject({ id });
    expect(renew).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    const [first, replay] = requests as [Request, Request];
    expect(replay.method).toBe("PUT");
    expect(replay.url).toBe(first.url);
    expect(replay.headers.get("Idempotency-Key")).toBe("0199a1b2-0000-7000-8000-00000000000a");
    expect(replay.headers.get("If-Match")).toBe('"AAAA"');
    expect(first.headers.get("Authorization")).toBe("Bearer velho");
    expect(replay.headers.get("Authorization")).toBe("Bearer novo");
    expect(await replay.json()).toEqual({ name: "Ana" });
  });

  it("outra chamada já renovou: reenvia com o token atual, sem outro refresh", async () => {
    const { client, requests, renew, state } = renewing([
      () => {
        state.token = "novo";
        return unauthorized();
      },
    ]);

    await put(client);

    expect(renew).not.toHaveBeenCalled();
    expect(requests.map((r) => r.headers.get("Authorization"))).toEqual([
      "Bearer velho",
      "Bearer novo",
    ]);
  });

  it("refresh recusado (expired): devolve o 401, sem reenvio", async () => {
    const { client, requests } = renewing([unauthorized], "expired");

    const result = await put(client);

    expect(requests).toHaveLength(1);
    expect(readFailure(result)).toMatchObject({
      kind: "problem",
      problem: { type: "urn:vistoria:problem:unauthorized" },
    });
  });

  it("refresh sem resposta (offline): vira falha de rede, para a fila tentar de novo sem expirar", async () => {
    const { client, requests } = renewing([unauthorized], "offline");

    const result = await put(client);

    expect(requests).toHaveLength(1);
    expect(readFailure(result)).toMatchObject({ kind: "network" });
  });

  it("reenvia uma vez só: o reenvio com 401 volta para quem chamou", async () => {
    const { client, requests, renew } = renewing([unauthorized, unauthorized]);

    const result = await put(client);

    expect(renew).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    expect(readFailure(result)).toMatchObject({ kind: "problem" });
  });

  it("decide pelo type: 401 sem ProblemDetails, ou outro type, não renova", async () => {
    const { client, renew } = renewing([
      () => new Response("<html>401</html>", { status: 401 }),
      () => Response.json(problemDetails, { status: 409 }),
    ]);

    await put(client);
    await put(client);

    expect(renew).not.toHaveBeenCalled();
  });

  it("/auth/* nunca renova: o 401 do próprio refresh volta para a sessão", async () => {
    const { client, requests, renew } = renewing([unauthorized]);

    await refreshToken({ client });

    expect(renew).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it("sem renew registrado: o 401 volta para quem chamou", async () => {
    const { client, requests } = setup(() => "velho", unauthorized);

    const result = await getClient({ client, path: { id } });

    expect(requests).toHaveLength(1);
    expect(readFailure(result)).toMatchObject({ kind: "problem" });
  });
});
