// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import { RejectedSyncError, RetryableSyncError, shouldRetry } from "@/shared/sync/outbox";

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
  { stored = [] as ClientRecord[], queued = [] as ClientRecord[] } = {},
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
  // A camada otimista: o que está na fila, por cima da store.
  const optimistic = new Map(queued.map((row) => [row.id, row]));
  const clients = {
    utils: { acceptMutations, exportData: async () => stored },
    get: (key: string) => optimistic.get(key),
    has: (key: string) => optimistic.has(key),
    insert: (row: ClientRecord) => optimistic.set(row.id, row),
    update: (key: string, change: (row: ClientRecord) => void) => change(optimistic.get(key)!),
  } as unknown as ClientsCollection;
  const drafts = new Map<string, Record<string, unknown>>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
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
    optimistic,
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

  it.each([
    ["412", 412],
    ["409", 409],
  ])("%s version-conflict → sai da fila sem gravar na store, e o registro vira rascunho em conflito com o current", async (_, status) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const current = { ...dto, name: "Alfa (outro aparelho)", version: "AAAAAAAAB9U=" };
    const { send, acceptMutations, drafts } = setup(() => problemWith("version-conflict", status, { current }));

    const error = (await send({ transaction: transactionOf(record), idempotencyKey }).catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(RejectedSyncError);
    expect(shouldRetry(error)).toBe(false);
    expect(acceptMutations).not.toHaveBeenCalled();
    expect(drafts.get(id)).toMatchObject({
      id,
      entity: "client",
      data: record,
      status: "conflict",
      errors: {},
      conflict: { current, collisions: [expect.objectContaining({ field: "name" })] },
    });
  });

  it("um conflito depois de uma recusa troca o rascunho, sem os erros antigos", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const current = { ...dto, name: "Alfa (outro aparelho)" };
    const { send, drafts } = setup(() => problemWith("version-conflict", 412, { current }));
    drafts.set(id, { id, status: "rejected", errors: { name: ["Curto."] } });

    await send({ transaction: transactionOf(record), idempotencyKey }).catch(() => {});

    expect(drafts.get(id)).toMatchObject({ status: "conflict", errors: {}, conflict: { current } });
  });

  describe('version-conflict com a serverShadow (frontend.md, "Conflito")', () => {
    const shadow: ClientRecord = { ...record, version: "AAAAAAAAB9M=" };
    const conflictWith = (current: Record<string, unknown>) => () =>
      problemWith("version-conflict", 412, { current });
    const serverAt = (version: string, fields: Partial<ClientRecord> = {}) => ({
      ...dto,
      ...fields,
      version,
      updatedAt: "2026-10-27T09:00:00+00:00",
    });

    it("a própria escrita cuja resposta se perdeu: sucesso, com a version do current, sem reenvio", async () => {
      const sent: ClientRecord = { ...shadow, name: "Alfa Imóveis" };
      const requeue = vi.fn<(mutate: () => void) => void>();
      const { send, requests, acceptMutations, drafts } = setup(
        conflictWith(serverAt("AAAAAAAAB9U=", { name: "Alfa Imóveis" })),
        { stored: [shadow] },
      );

      await send({ transaction: transactionOf(sent), idempotencyKey, requeue });

      expect(requests).toHaveLength(1);
      expect(requeue).not.toHaveBeenCalled();
      expect(acceptMutations.mock.calls[0]?.[0].mutations[0]?.modified).toEqual({
        ...sent,
        version: "AAAAAAAAB9U=",
      });
      expect(drafts.size).toBe(0);
    });

    it("campos diferentes: adota o current, e o merge vai para a fila numa transação nova", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const sent: ClientRecord = { ...shadow, name: "Alfa Imóveis" };
      const requeue = vi.fn<(mutate: () => void) => void>();
      const { send, acceptMutations, drafts, optimistic } = setup(
        conflictWith(serverAt("AAAAAAAAB9U=", { email: "vendas@alfa.com" })),
        { stored: [shadow], queued: [sent] },
      );

      await send({ transaction: transactionOf(sent), idempotencyKey, requeue });

      expect(acceptMutations.mock.calls[0]?.[0].mutations[0]?.modified).toEqual({
        ...shadow,
        email: "vendas@alfa.com",
        version: "AAAAAAAAB9U=",
      });
      expect(requeue).toHaveBeenCalledTimes(1);
      requeue.mock.calls[0]?.[0]();
      expect(optimistic.get(id)).toEqual({
        ...shadow,
        name: "Alfa Imóveis",
        email: "vendas@alfa.com",
        version: "AAAAAAAAB9U=",
      });
      expect(drafts.size).toBe(0);
    });

    it("o local é o mais novo da fila, não o corpo da transação que deu conflito", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const sent: ClientRecord = { ...shadow, name: "Alfa Imóveis" };
      const newer: ClientRecord = { ...sent, phone: "11 3333-4444" };
      const requeue = vi.fn<(mutate: () => void) => void>();
      const { send, optimistic } = setup(
        conflictWith(serverAt("AAAAAAAAB9U=", { email: "vendas@alfa.com" })),
        { stored: [shadow], queued: [newer] },
      );

      await send({ transaction: transactionOf(sent), idempotencyKey, requeue });

      requeue.mock.calls[0]?.[0]();
      expect(optimistic.get(id)).toMatchObject({
        name: "Alfa Imóveis",
        phone: "11 3333-4444",
        email: "vendas@alfa.com",
      });
    });

    it("merge igual ao servidor: só adota o current, sem reenviar", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const sent: ClientRecord = { ...shadow, name: "Alfa Imóveis" };
      const requeue = vi.fn<(mutate: () => void) => void>();
      const { send, acceptMutations, drafts } = setup(
        conflictWith(serverAt("AAAAAAAAB9U=", { name: "Alfa Imóveis", email: "vendas@alfa.com" })),
        { stored: [shadow], queued: [sent] },
      );

      await send({ transaction: transactionOf(sent), idempotencyKey, requeue });

      expect(requeue).not.toHaveBeenCalled();
      expect(acceptMutations.mock.calls[0]?.[0].mutations[0]?.modified).toMatchObject({
        name: "Alfa Imóveis",
        email: "vendas@alfa.com",
        version: "AAAAAAAAB9U=",
      });
      expect(drafts.size).toBe(0);
    });

    it("o mesmo campo dos dois lados: rascunho em conflito com base, current e a colisão, sem reenviar", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const sent: ClientRecord = { ...shadow, name: "Alfa Imóveis" };
      const current = serverAt("AAAAAAAAB9U=", { name: "Alfa Negócios" });
      const requeue = vi.fn<(mutate: () => void) => void>();
      const { send, acceptMutations, drafts } = setup(conflictWith(current), {
        stored: [shadow],
        queued: [sent],
      });

      const error = await send({ transaction: transactionOf(sent), idempotencyKey, requeue }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(RejectedSyncError);
      expect(requeue).not.toHaveBeenCalled();
      expect(acceptMutations).not.toHaveBeenCalled();
      expect(drafts.get(id)).toMatchObject({
        status: "conflict",
        data: sent,
        conflict: {
          current,
          base: shadow,
          collisions: [
            {
              field: "name",
              base: "Imobiliária Alfa",
              local: "Alfa Imóveis",
              server: "Alfa Negócios",
            },
          ],
        },
      });
    });

    it("sem como pôr na fila (chamada fora da outbox): fica com a pessoa, nada se perde", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const sent: ClientRecord = { ...shadow, name: "Alfa Imóveis" };
      const { send, acceptMutations, drafts } = setup(
        conflictWith(serverAt("AAAAAAAAB9U=", { email: "vendas@alfa.com" })),
        { stored: [shadow], queued: [sent] },
      );

      await expect(
        send({ transaction: transactionOf(sent), idempotencyKey }),
      ).rejects.toBeInstanceOf(RejectedSyncError);
      expect(acceptMutations).not.toHaveBeenCalled();
      expect(drafts.get(id)).toMatchObject({ status: "conflict", conflict: { collisions: [] } });
    });
  });


  it("409 idempotency-in-progress com Retry-After: 2 só volta para a fila depois de 2 s, com a mesma chave", async () => {
    vi.useFakeTimers();
    try {
      const { send, requests } = setup(() => {
        const response = problem("idempotency-in-progress", 409);
        response.headers.set("Retry-After", "2");
        return response;
      });
      let settled: unknown;

      const sending = send({ transaction: transactionOf(record), idempotencyKey }).catch((error) => {
        settled = error;
      });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await sending;

      expect(settled).toBeInstanceOf(RetryableSyncError);
      expect((settled as RetryableSyncError).retryAfterMs).toBe(2_000);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.headers.get("Idempotency-Key")).toBe(idempotencyKey);
    } finally {
      vi.useRealTimers();
    }
  });

  it("duas edições seguidas: a segunda sai com If-Match da version que a primeira devolveu", async () => {
    const versions = ["AAAAAAAAB9Q=", "AAAAAAAAB9U="];
    const stored: ClientRecord[] = [{ ...record, version: "AAAAAAAAB9M=" }];
    const { send, requests, acceptMutations } = setup(
      () => Response.json({ ...dto, version: versions[requests.length - 1] }),
      { stored },
    );
    // A store de verdade guarda o que o 2xx confirmou; aqui, o mesmo à mão.
    acceptMutations.mockImplementation(async ({ mutations }) => {
      stored[0] = mutations[0]!.modified as ClientRecord;
    });

    await send({ transaction: transactionOf({ ...record, name: "Alfa 1" }), idempotencyKey });
    await send({ transaction: transactionOf({ ...record, name: "Alfa 2" }), idempotencyKey: `${idempotencyKey}-2` });

    expect(requests.map((request) => request.headers.get("If-Match"))).toEqual(['"AAAAAAAAB9M="', '"AAAAAAAAB9Q="']);
    expect(stored[0]).toMatchObject({ name: "Alfa 2", version: "AAAAAAAAB9U=" });
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
