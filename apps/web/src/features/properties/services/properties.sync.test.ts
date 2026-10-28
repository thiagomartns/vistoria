// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import { RejectedSyncError } from "@/shared/sync/outbox";
import type { OutboxEntry } from "@/shared/sync/sync-status";
import { describeSync } from "@/shared/sync/sync-view";

import type { PropertyRecord } from "../models/property";
import type { PropertiesCollection } from "./properties.collection";
import { UPSERT_PROPERTY, upsertPropertyMutation } from "./properties.sync";

// A mutationFn de properties com um fetch falso. O caminho comum (chave, If-Match, store depois do 2xx) é o mesmo de
// clients (upsertMutation) e tem os testes lá; aqui, o que é do imóvel: a rota, o corpo e a recusa por campo.

const id = "01a16032-2dfb-77de-84a2-1f165bdd993f";
const idempotencyKey = "01a16032-2dfc-7334-9752-3da4fdcc2e87";
const record: PropertyRecord = {
  id,
  version: null,
  clientId: "01a16032-2dfb-77de-84a2-1f165bdd993e",
  street: "Rua das Flores",
  number: "120",
  complement: "ap 32",
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: null,
};
const dto = {
  ...record,
  version: "AAAAAAAAB9M=",
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};

function setup(respond: () => Response, stored: PropertyRecord[] = []) {
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
  const properties = {
    utils: { acceptMutations, exportData: async () => stored },
    get: () => undefined,
  } as unknown as PropertiesCollection;
  const drafts = new Map<string, Record<string, unknown>>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: { id: string }) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: Record<string, unknown>) => void) => change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  return { send: upsertPropertyMutation(properties, draftsCollection, client), requests, acceptMutations, drafts };
}

const transactionOf = (modified: PropertyRecord) => ({ mutations: [{ modified }] }) as never;

describe("upsertPropertyMutation", () => {
  it("envia PUT /api/v1/properties/{id} com a chave e o registro sem id nem version", async () => {
    const { send, requests, acceptMutations } = setup(() => Response.json(dto, { status: 201 }));

    await send({ transaction: transactionOf(record), idempotencyKey });

    const [request] = requests;
    expect(request?.method).toBe("PUT");
    expect(new URL(request!.url).pathname).toBe(`/api/v1/properties/${id}`);
    expect(request?.headers.get("Idempotency-Key")).toBe(idempotencyKey);
    expect(request?.headers.has("If-Match")).toBe(false);
    const { id: _id, version: _version, ...body } = record;
    expect(await request?.json()).toEqual(body);
    expect(acceptMutations.mock.calls[0]?.[0].mutations[0]?.modified).toEqual({ ...record, version: dto.version });
  });

  it("imóvel já confirmado: If-Match com a version da store", async () => {
    const { send, requests } = setup(() => Response.json({ ...dto, version: "AAAAAAAAB9Q=" }), [
      { ...record, version: "AAAAAAAAB9M=" },
    ]);

    await send({ transaction: transactionOf({ ...record, number: "122" }), idempotencyKey });

    expect(requests[0]?.headers.get("If-Match")).toBe('"AAAAAAAAB9M="');
  });

  it("400 validation em state, zipCode e clientId → rascunho de property com os erros por campo", async () => {
    const errors = {
      state: ["Informe a sigla de uma UF, em maiúsculas."],
      zipCode: ["Informe o CEP com 8 dígitos, sem hífen."],
      clientId: ["Cliente não encontrado."],
    };
    const { send, acceptMutations, drafts } = setup(() =>
      Response.json(
        {
          type: "urn:vistoria:problem:validation",
          title: "validation",
          status: 400,
          detail: "validation",
          traceId: "00-trace",
          errors,
        },
        { status: 400, headers: { "content-type": "application/problem+json" } },
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(send({ transaction: transactionOf(record), idempotencyKey })).rejects.toBeInstanceOf(
      RejectedSyncError,
    );

    expect(acceptMutations).not.toHaveBeenCalled();
    expect(drafts.get(id)).toMatchObject({ id, entity: "property", data: record, status: "rejected", errors });
  });

  it("412 version-conflict → rascunho de property em conflito, com o current, sem gravar na store", async () => {
    const current = { ...dto, number: "121", version: "AAAAAAAAB9U=" };
    const { send, acceptMutations, drafts } = setup(() =>
      Response.json(
        {
          type: "urn:vistoria:problem:version-conflict",
          title: "version-conflict",
          status: 412,
          detail: "version-conflict",
          traceId: "00-trace",
          current,
        },
        { status: 412, headers: { "content-type": "application/problem+json" } },
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(send({ transaction: transactionOf(record), idempotencyKey })).rejects.toBeInstanceOf(
      RejectedSyncError,
    );

    expect(acceptMutations).not.toHaveBeenCalled();
    expect(drafts.get(id)).toMatchObject({ id, entity: "property", data: record, status: "conflict", conflict: { current, collisions: expect.anything() } });
  });

  it("no painel de pendências, o imóvel aparece pelo endereço", () => {
    const entry: OutboxEntry = {
      id: "t1",
      mutationFnName: UPSERT_PROPERTY,
      record,
      createdAt: new Date("2026-10-22T12:00:00Z"),
      retryCount: 0,
      nextAttemptAt: 0,
    };
    const view = describeSync(
      { online: false, entries: [entry], running: 0, lastSyncedAt: null, outboxRead: true },
      new Date("2026-10-22T12:01:00Z"),
    );
    expect(view.panel.waiting[0]?.title).toBe("Imóvel · Rua das Flores, 120 · ap 32");
  });
});
