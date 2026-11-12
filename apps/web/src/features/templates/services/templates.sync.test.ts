// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import { RejectedSyncError } from "@/shared/sync/outbox";
import type { OutboxEntry } from "@/shared/sync/sync-status";
import { describeSync } from "@/shared/sync/sync-view";

import type { TemplateRecord } from "../models/template";
import type { TemplatesCollection } from "./templates.collection";
import { UPSERT_TEMPLATE, templateRecordOf, upsertTemplateMutation } from "./templates.sync";

// A mutationFn de templates com um fetch falso. O caminho comum (chave, store depois do 2xx, reenvio) é o mesmo de
// clients (upsertMutation) e tem os testes lá; aqui, o que é do roteiro: a rota, o corpo com ambientes e itens, a
// recusa por campo aninhado e o conflito.

const id = "01a16032-2dfb-77de-84a2-1f165bdd9b01";
const idempotencyKey = "01a16032-2dfc-7334-9752-3da4fdcc2e87";
const record: TemplateRecord = {
  id,
  version: null,
  name: "Apartamento",
  rooms: [
    {
      id: "01a16032-2dfb-77de-84a2-1f165bdd9c01",
      name: "Sala",
      position: 0,
      items: [
        { id: "01a16032-2dfb-77de-84a2-1f165bdd9d01", name: "Piso", position: 0 },
        { id: "01a16032-2dfb-77de-84a2-1f165bdd9d02", name: "Teto", position: 1 },
      ],
    },
  ],
};
const dto = {
  ...record,
  version: "AAAAAAAAB9M=",
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};

const problem = (type: string, status: number, extra: Record<string, unknown>) =>
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

function setup(respond: () => Response, stored: TemplateRecord[] = []) {
  const requests: Request[] = [];
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      requests.push(input as Request);
      return respond();
    },
  });
  const acceptMutations = vi.fn<
    (transaction: { mutations: { modified: unknown }[] }) => Promise<void>
  >(async () => {});
  const templates = {
    utils: {
      acceptMutations,
      exportData: async () => stored,
      readConfirmed: async (ids: readonly string[]) => stored.filter((row) => ids.includes(row.id)),
    },
    get: () => undefined,
  } as unknown as TemplatesCollection;
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
    send: upsertTemplateMutation(templates, draftsCollection, client),
    requests,
    acceptMutations,
    drafts,
  };
}

const transactionOf = (modified: TemplateRecord) => ({ mutations: [{ modified }] }) as never;

describe("upsertTemplateMutation", () => {
  it("envia PUT /api/v1/templates/{id} com a chave, sem If-Match, e o roteiro sem id nem version", async () => {
    const { send, requests, acceptMutations } = setup(() => Response.json(dto, { status: 201 }));

    await send({ transaction: transactionOf(record), idempotencyKey });

    const [request] = requests;
    expect(request?.method).toBe("PUT");
    expect(new URL(request!.url).pathname).toBe(`/api/v1/templates/${id}`);
    expect(request?.headers.get("Idempotency-Key")).toBe(idempotencyKey);
    expect(request?.headers.has("If-Match")).toBe(false);
    const { id: _id, version: _version, ...body } = record;
    expect(await request?.json()).toEqual(body);
    expect(acceptMutations.mock.calls[0]?.[0].mutations[0]?.modified).toEqual({
      ...record,
      version: dto.version,
    });
  });

  it("roteiro já confirmado: If-Match com a version da store", async () => {
    const { send, requests } = setup(
      () => Response.json({ ...dto, version: "AAAAAAAAB9Q=" }),
      [{ ...record, version: "AAAAAAAAB9M=" }],
    );

    await send({
      transaction: transactionOf({ ...record, name: "Apartamento grande" }),
      idempotencyKey,
    });

    expect(requests[0]?.headers.get("If-Match")).toBe('"AAAAAAAAB9M="');
  });

  it("400 validation num item → rascunho de template com o erro no caminho do campo", async () => {
    const errors = { "rooms[0].items[1].name": ["Informe o nome do item, com até 60 caracteres."] };
    const { send, acceptMutations, drafts } = setup(() => problem("validation", 400, { errors }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      send({ transaction: transactionOf(record), idempotencyKey }),
    ).rejects.toBeInstanceOf(RejectedSyncError);

    expect(acceptMutations).not.toHaveBeenCalled();
    expect(drafts.get(id)).toMatchObject({
      id,
      entity: "template",
      data: record,
      status: "rejected",
      errors,
    });
  });

  it("412 version-conflict nos ambientes → rascunho de template em conflito, com o current, sem gravar na store", async () => {
    const base = { ...record, version: "AAAAAAAAB9M=" };
    const current = {
      ...dto,
      version: "AAAAAAAAB9U=",
      rooms: [{ ...record.rooms[0]!, name: "Sala de estar" }],
    };
    const { send, acceptMutations, drafts } = setup(
      () => problem("version-conflict", 412, { current }),
      [base],
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const local = { ...record, rooms: [{ ...record.rooms[0]!, name: "Living" }] };

    await expect(
      send({ transaction: transactionOf(local), idempotencyKey }),
    ).rejects.toBeInstanceOf(RejectedSyncError);

    expect(acceptMutations).not.toHaveBeenCalled();
    // O merge plano: a lista de ambientes é um campo só, e os dois lados a mudaram (provisório até a #173).
    expect(drafts.get(id)).toMatchObject({
      id,
      entity: "template",
      status: "conflict",
      conflict: { current, collisions: [expect.objectContaining({ field: "rooms" })] },
    });
  });

  it("no painel de pendências, o roteiro aparece pelo nome", () => {
    const entry: OutboxEntry = {
      id: "t1",
      mutationFnName: UPSERT_TEMPLATE,
      record,
      createdAt: new Date("2026-10-22T12:00:00Z"),
      retryCount: 0,
      nextAttemptAt: 0,
    };
    const view = describeSync(
      { online: false, entries: [entry], running: 0, lastSyncedAt: null, outboxRead: true },
      new Date("2026-10-22T12:01:00Z"),
    );
    expect(view.panel.waiting[0]?.title).toBe("Roteiro · Apartamento");
  });
});

describe("templateRecordOf", () => {
  it("fica com o que vai no PUT e a version, com ambientes e itens na ordem da posição", () => {
    const [room] = record.rooms;
    const kitchen = {
      id: "01a16032-2dfb-77de-84a2-1f165bdd9c02",
      name: "Cozinha",
      position: 1,
      items: [],
    };
    const shuffled = {
      ...dto,
      rooms: [kitchen, { ...room!, items: [...room!.items].reverse() }],
    };

    expect(templateRecordOf(shuffled)).toEqual({
      ...record,
      version: dto.version,
      rooms: [room, kitchen],
    });
  });
});
