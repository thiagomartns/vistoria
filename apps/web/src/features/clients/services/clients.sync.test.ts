// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import { RejectedSyncError, RetryableSyncError } from "@/shared/sync/outbox";

import type { DraftsCollection } from "@/shared/sync/drafts";

import type { ClientRecord } from "../models/client";
import type { ClientsCollection } from "./clients.collection";
import { upsertClientMutation } from "./clients.sync";

// A mutationFn de clients com um fetch falso: o que vai no PUT (com If-Match quando o registro já está no servidor),
// o que a store recebe e o que acontece em cada falha.

const id = "01a16032-2dfb-77de-84a2-1f165bdd993e";
const idempotencyKey = "01a16032-2dfc-7334-9752-3da4fdcc2e86";
const record: ClientRecord = {
  id,
  version: null,
  name: "Imobiliária Alfa",
  document: null,
  email: "contato@alfa.com",
  phone: null,
};
const dto = {
  ...record,
  version: "AAAAAAAAB9M=",
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};

function setup(
  respond: () => Response | Promise<Response>,
  { stored = [] as ClientRecord[] } = {},
) {
  const requests: Request[] = [];
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      requests.push(input as Request);
      return respond();
    },
  });
  const acceptMutations = vi.fn<(transaction: { mutations: { modified: unknown }[] }) => Promise<void>>(
    async () => {},
  );
  const clients = {
    utils: { acceptMutations, exportData: async () => stored },
  } as unknown as ClientsCollection;
  const drafts = new Map<string, Record<string, unknown>>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    insert: (draft: { id: string }) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: Record<string, unknown>) => void) =>
      change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  return {
    send: upsertClientMutation(clients, draftsCollection, client),
    requests,
    acceptMutations,
    drafts,
  };
}

function transactionOf(...modified: ClientRecord[]) {
  return { mutations: modified.map((row) => ({ modified: row })) } as never;
}

const problemWith = (type: string, status: number, extra: Record<string, unknown> = {}) =>
  Response.json(
    {
      type: `urn:vistoria:problem:${type}`,
      title: type,
      status,
      detail: type,
      traceId: "00-trace",
      ...extra,
    },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const problem = (type: string, status: number) => problemWith(type, status);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsertClientMutation", () => {
  it("envia PUT /api/v1/clients/{id} com Authorization, a chave da transação e o registro sem id nem version", async () => {
    const { send, requests } = setup(() => Response.json(dto, { status: 201 }));

    await send({ transaction: transactionOf(record), idempotencyKey });

    const [request] = requests;
    expect(request?.method).toBe("PUT");
    expect(new URL(request!.url).pathname).toBe(`/api/v1/clients/${id}`);
    expect(request?.headers.get("Authorization")).toBe("Bearer t0k3n");
    expect(request?.headers.get("Idempotency-Key")).toBe(idempotencyKey);
    expect(await request?.json()).toEqual({
      name: record.name,
      document: null,
      email: record.email,
      phone: null,
    });
  });

  it("registro que só existe no aparelho: sem If-Match", async () => {
    const { send, requests } = setup(() => Response.json(dto, { status: 201 }));

    await send({ transaction: transactionOf(record), idempotencyKey });

    expect(requests[0]?.headers.has("If-Match")).toBe(false);
  });

  it("registro já confirmado: If-Match com a version da store, lida na hora do envio", async () => {
    const stored = [{ ...record, version: "AAAAAAAAB9M=" }];
    const { send, requests } = setup(() => Response.json({ ...dto, version: "AAAAAAAAB9Q=" }), {
      stored,
    });

    // A transação foi enfileirada quando a store ainda não tinha versão (edição em cima de uma criação pendente).
    await send({ transaction: transactionOf({ ...record, name: "Alfa Imóveis" }), idempotencyKey });

    expect(requests[0]?.headers.get("If-Match")).toBe('"AAAAAAAAB9M="');
  });

  it("2xx: a store recebe o registro com a version da resposta", async () => {
    const { send, acceptMutations } = setup(() => Response.json(dto, { status: 201 }));

    await send({ transaction: transactionOf(record), idempotencyKey });

    expect(acceptMutations).toHaveBeenCalledOnce();
    expect(acceptMutations.mock.calls[0]?.[0].mutations[0]?.modified).toEqual({
      ...record,
      version: dto.version,
    });
  });

  it("2xx apaga o rascunho recusado do registro", async () => {
    const { send, drafts } = setup(() => Response.json(dto));
    drafts.set(id, { id });

    await send({ transaction: transactionOf(record), idempotencyKey });

    expect(drafts.has(id)).toBe(false);
  });

  it("reenviar a mesma transação repete a chave e o corpo", async () => {
    const { send, requests } = setup(() => Response.json(dto));
    const transaction = transactionOf(record);

    await send({ transaction, idempotencyKey });
    await send({ transaction, idempotencyKey });

    const bodies = await Promise.all(requests.map((request) => request.text()));
    expect(requests.map((request) => request.headers.get("Idempotency-Key"))).toEqual([
      idempotencyKey,
      idempotencyKey,
    ]);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it.each([
    ["rede", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["500 internal", () => problem("internal", 500)],
    ["502 em HTML", () => new Response("<html>Bad Gateway</html>", { status: 502 })],
  ])("%s → RetryableSyncError, sem gravar na store nem rascunho", async (_, respond) => {
    const { send, acceptMutations, drafts } = setup(respond);

    await expect(
      send({ transaction: transactionOf(record), idempotencyKey }),
    ).rejects.toBeInstanceOf(RetryableSyncError);
    expect(acceptMutations).not.toHaveBeenCalled();
    expect(drafts.size).toBe(0);
  });

  it("400 validation → RejectedSyncError, sem gravar na store, e o registro vira rascunho com os erros", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { send, acceptMutations, drafts } = setup(() =>
      problemWith("validation", 400, {
        errors: { document: ["Informe um CPF ou CNPJ válido, sem pontuação."] },
      }),
    );

    await expect(
      send({ transaction: transactionOf(record), idempotencyKey }),
    ).rejects.toBeInstanceOf(RejectedSyncError);
    expect(acceptMutations).not.toHaveBeenCalled();
    expect(drafts.get(id)).toMatchObject({
      id,
      entity: "client",
      data: record,
      status: "rejected",
      errors: { document: ["Informe um CPF ou CNPJ válido, sem pontuação."] },
    });
  });

  it("outra recusa (428) não vira rascunho", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { send, drafts } = setup(() => problem("precondition-required", 428));

    await expect(
      send({ transaction: transactionOf(record), idempotencyKey }),
    ).rejects.toBeInstanceOf(RejectedSyncError);
    expect(drafts.size).toBe(0);
  });

  it("recusa transação com mais de um registro (uma chave vale para um corpo)", async () => {
    const { send, requests } = setup(() => Response.json(dto));

    await expect(
      send({ transaction: transactionOf(record, { ...record, id: "outro" }), idempotencyKey }),
    ).rejects.toBeInstanceOf(RejectedSyncError);
    expect(requests).toHaveLength(0);
  });
});
