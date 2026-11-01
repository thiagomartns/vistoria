// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import { RejectedSyncError } from "@/shared/sync/outbox";
import type { OutboxEntry } from "@/shared/sync/sync-status";
import { describeSync } from "@/shared/sync/sync-view";

import type { InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import { UPSERT_INSPECTION, upsertInspectionMutation } from "./inspections.sync";

// A mutationFn de inspections com um fetch falso. O caminho comum (chave, If-Match, store depois do 2xx) é o mesmo de
// clients (upsertMutation) e tem os testes lá; aqui, o que é da vistoria: a rota, o agregado inteiro no corpo, o
// encadeamento das versões e os erros por caminho aninhado.

const idempotencyKey = "01a16032-2dfc-7334-9752-3da4fdcc2e87";
const record: InspectionRecord = newMoveInInspection("01a16032-2dfb-77de-84a2-1f165bdd993e");
const { id } = record;

const dtoOf = (sent: InspectionRecord, version: string) => ({
  ...sent,
  version,
  referenceInspectionId: null,
  completedAt: null,
  rooms: sent.rooms.map((room) => ({
    ...room,
    items: room.items.map((item) => ({ ...item, referenceCondition: null, referenceNotes: null })),
  })),
  createdAt: "2026-10-26T13:00:01Z",
  updatedAt: "2026-10-26T13:00:01Z",
});

/** Um servidor falso que devolve cada resposta da lista em ordem, e uma store que guarda o que ele confirmou. */
function setup(responses: (() => Response)[], stored: InspectionRecord[] = []) {
  const requests: Request[] = [];
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      requests.push(input as Request);
      return responses[requests.length - 1]!();
    },
  });
  const confirmed = new Map(stored.map((inspection) => [inspection.id, inspection]));
  const inspections = {
    utils: {
      exportData: async () => [...confirmed.values()],
      readConfirmed: async (ids: readonly string[]) => ids.flatMap((key) => confirmed.get(key) ?? []),
      acceptMutations: async ({ mutations }: { mutations: { modified: InspectionRecord }[] }) => {
        for (const { modified } of mutations) confirmed.set(modified.id, modified);
      },
    },
  } as unknown as InspectionsCollection;
  const drafts = new Map<string, Record<string, unknown>>();
  const draftsCollection = {
    has: (key: string) => drafts.has(key),
    get: (key: string) => drafts.get(key),
    insert: (draft: { id: string }) => drafts.set(draft.id, draft),
    update: (key: string, change: (draft: Record<string, unknown>) => void) => change(drafts.get(key)!),
    delete: (key: string) => drafts.delete(key),
  } as unknown as DraftsCollection;
  return {
    send: upsertInspectionMutation(inspections, draftsCollection, client),
    requests,
    confirmed,
    drafts,
  };
}

const transactionOf = (modified: InspectionRecord) => ({ mutations: [{ modified }] }) as never;

const problem = (status: number, body: Record<string, unknown>) => () =>
  Response.json(
    { title: "", status, detail: "", traceId: "00-trace", ...body },
    { status, headers: { "content-type": "application/problem+json" } },
  );

describe("upsertInspectionMutation", () => {
  it("criada no aparelho: PUT /api/v1/inspections/{id} sem If-Match, com o agregado inteiro; o 201 grava a version", async () => {
    const { send, requests, confirmed } = setup([() => Response.json(dtoOf(record, "AAAAAAAAB9M="), { status: 201 })]);

    await send({ transaction: transactionOf(record), idempotencyKey });

    const [request] = requests;
    expect(request?.method).toBe("PUT");
    expect(new URL(request!.url).pathname).toBe(`/api/v1/inspections/${id}`);
    expect(request?.headers.get("Idempotency-Key")).toBe(idempotencyKey);
    expect(request?.headers.has("If-Match")).toBe(false);
    const body = await request?.json();
    const { id: _id, version: _version, ...expected } = record;
    expect(body).toEqual(expected);
    // Nada do que o servidor define vai no corpo.
    expect(JSON.stringify(body)).not.toMatch(/completedAt|reference|createdAt|updatedAt|version/);
    expect(confirmed.get(id)).toEqual({ ...record, version: "AAAAAAAAB9M=" });
  });

  it("edição depois do envio: If-Match com a version confirmada; duas seguidas saem encadeadas", async () => {
    const { send, requests } = setup(
      [
        () => Response.json(dtoOf(record, "AAAAAAAAB9Q=")),
        () => Response.json(dtoOf(record, "AAAAAAAAB9U=")),
      ],
      [{ ...record, version: "AAAAAAAAB9M=" }],
    );
    const evaluated = (condition: "good" | "fair"): InspectionRecord => ({
      ...record,
      rooms: record.rooms.map((room, index) =>
        index === 0
          ? { ...room, items: room.items.map((item, i) => (i === 0 ? { ...item, condition } : item)) }
          : room,
      ),
    });

    await send({ transaction: transactionOf(evaluated("good")), idempotencyKey });
    await send({ transaction: transactionOf(evaluated("fair")), idempotencyKey: "01a16032-2dfc-7334-9752-3da4fdcc2e88" });

    expect(requests.map((request) => request.headers.get("If-Match"))).toEqual(['"AAAAAAAAB9M="', '"AAAAAAAAB9Q="']);
    expect((await requests[1]!.json()).rooms[0].items[0].condition).toBe("fair");
  });

  it("400 em rooms[i].items[j].*: o rascunho recusado guarda os erros com a chave do servidor", async () => {
    const errors = {
      "rooms[0].items[1].name": ["O nome do item precisa ter de 1 a 60 caracteres."],
      "rooms[2].items[0].condition": ["O valor não é válido."],
    };
    const { send, confirmed, drafts } = setup([problem(400, { type: "urn:vistoria:problem:validation", errors })]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(send({ transaction: transactionOf(record), idempotencyKey })).rejects.toBeInstanceOf(
      RejectedSyncError,
    );

    expect(confirmed.has(id)).toBe(false);
    expect(drafts.get(id)).toMatchObject({ id, entity: "inspection", data: record, status: "rejected", errors });
  });

  it("no painel de pendências, a vistoria aparece com o número de ambientes", () => {
    const entry: OutboxEntry = {
      id: "t1",
      mutationFnName: UPSERT_INSPECTION,
      record,
      createdAt: new Date("2026-10-26T13:00:00Z"),
      retryCount: 0,
      nextAttemptAt: 0,
    };
    const view = describeSync(
      { online: false, entries: [entry], running: 0, lastSyncedAt: null, outboxRead: true },
      new Date("2026-10-26T13:01:00Z"),
    );
    expect(view.panel.waiting[0]?.title).toBe("Vistoria · 5 ambientes");
  });
});
