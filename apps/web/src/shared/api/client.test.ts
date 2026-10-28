// @vitest-environment node

import { describe, expect, it } from "vitest";

import { type AccessTokenSource, configureClient, readFailure } from "./client";
import { getClient, signIn } from "./generated";
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
