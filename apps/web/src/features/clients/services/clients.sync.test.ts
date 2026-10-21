// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import { RejectedSyncError, RetryableSyncError } from "@/shared/sync/outbox";

import type { ClientRecord } from "../models/client";
import type { ClientsCollection } from "./clients.collection";
import { upsertClientMutation } from "./clients.sync";

// A mutationFn de clients com um fetch falso: o que vai no PUT e o que acontece em cada falha.

const id = "01a16032-2dfb-77de-84a2-1f165bdd993e";
const idempotencyKey = "01a16032-2dfc-7334-9752-3da4fdcc2e86";
const record: ClientRecord = {
  id,
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

function setup(respond: () => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      requests.push(input as Request);
      return respond();
    },
  });
  const acceptMutations = vi.fn<(transaction: unknown) => Promise<void>>(async () => {});
  const clients = { utils: { acceptMutations } } as unknown as ClientsCollection;
  return { send: upsertClientMutation(clients, client), requests, acceptMutations };
}

function transactionOf(...modified: ClientRecord[]) {
  return { mutations: modified.map((row) => ({ modified: row })) } as never;
}

const problem = (type: string, status: number) =>
  Response.json(
    {
      type: `urn:vistoria:problem:${type}`,
      title: type,
      status,
      detail: type,
      traceId: "00-trace",
    },
    { status, headers: { "content-type": "application/problem+json" } },
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsertClientMutation", () => {
  it("envia PUT /api/v1/clients/{id} com Authorization, a chave da transação e o registro sem o id", async () => {
    const { send, requests, acceptMutations } = setup(() => Response.json(dto, { status: 201 }));
    const transaction = transactionOf(record);

    await send({ transaction, idempotencyKey });

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
    expect(acceptMutations).toHaveBeenCalledWith(transaction);
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
  ])("%s → RetryableSyncError, sem gravar na store", async (_, respond) => {
    const { send, acceptMutations } = setup(respond);

    await expect(
      send({ transaction: transactionOf(record), idempotencyKey }),
    ).rejects.toBeInstanceOf(RetryableSyncError);
    expect(acceptMutations).not.toHaveBeenCalled();
  });

  it("400 validation → RejectedSyncError, sem gravar na store", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { send, acceptMutations } = setup(() => problem("validation", 400));

    await expect(
      send({ transaction: transactionOf(record), idempotencyKey }),
    ).rejects.toBeInstanceOf(RejectedSyncError);
    expect(acceptMutations).not.toHaveBeenCalled();
  });

  it("recusa transação com mais de um registro (uma chave vale para um corpo)", async () => {
    const { send, requests } = setup(() => Response.json(dto));

    await expect(
      send({ transaction: transactionOf(record, { ...record, id: "outro" }), idempotencyKey }),
    ).rejects.toBeInstanceOf(RejectedSyncError);
    expect(requests).toHaveLength(0);
  });
});
