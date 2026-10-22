import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Outbox, RetryableSyncError, enqueue, startOutbox } from "./outbox";

// A ordem da outbox com o executor de verdade (ADR 0034): uma transação por vez, na ordem de criação, e a da frente
// segura as de trás, inclusive no backoff. É o que faz o imóvel criado com um cliente pendente sair depois dele.
// Se um upgrade do @tanstack/offline-transactions passar a enviar em paralelo, este teste quebra.

vi.mock("../auth/session", () => ({
  canSendAs: () => true,
  sessionStore: { subscribe: () => () => {} },
  expireSession: () => {},
}));

// Web Locks mínimo: o jsdom não tem `navigator.locks`, e sem ele o executor elege o líder pelo BroadcastChannel, que
// nunca elege no jsdom. Sem líder, a outbox não guarda a fila e envia direto. No navegador, é o WebLocksLeader.
function fakeLocks() {
  const held = new Map<string, Promise<unknown>>();
  return {
    async request(
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => unknown,
    ) {
      if (options.ifAvailable) return callback(held.has(name) ? null : { name });
      while (held.has(name)) await held.get(name)!.catch(() => {});
      const holding = Promise.resolve().then(() => callback({ name }));
      held.set(name, holding);
      try {
        return await holding;
      } finally {
        held.delete(name);
      }
    },
  };
}

Object.defineProperty(navigator, "locks", { value: fakeLocks(), configurable: true });

type Row = { id: string; clientId?: string };

const OWNER = "ana";

function collections() {
  return {
    clients: createCollection(localOnlyCollectionOptions<Row, string>({ id: "clients", getKey: (row) => row.id })),
    properties: createCollection(
      localOnlyCollectionOptions<Row, string>({ id: "properties", getKey: (row) => row.id }),
    ),
  };
}

/** Uma mutationFn que anota cada envio e responde pelo `answer`: lança para falhar, devolve para aceitar. */
function recorder(answer: (entity: string, id: string, attempt: number) => void) {
  const sent: string[] = [];
  const fn = (entity: string) => async ({ transaction }: { transaction: { mutations: { modified: unknown }[] } }) => {
    const { id } = transaction.mutations[0]!.modified as Row;
    sent.push(`${entity}:${id}`);
    answer(entity, id, sent.filter((entry) => entry === `${entity}:${id}`).length);
  };
  return { sent, upsertClient: fn("client"), upsertProperty: fn("property") };
}

function start(record: ReturnType<typeof recorder>) {
  const { clients, properties } = collections();
  const outbox = startOutbox({
    ownerId: OWNER,
    collections: { clients, properties },
    mutationFns: { upsertClient: record.upsertClient, upsertProperty: record.upsertProperty },
  });
  return { outbox, clients, properties };
}

/** Espera a outbox virar líder: antes disso ela não guarda nada. */
async function ready(outbox: Outbox) {
  await outbox.waitForInit();
  await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
}

const retry = () => new RetryableSyncError("retry", { kind: "network", cause: new TypeError("Failed to fetch") });

let open: Outbox[] = [];

afterEach(() => {
  for (const outbox of open) outbox.dispose();
  open = [];
  localStorage.clear();
});

describe("outbox serial", () => {
  it("o imóvel espera o cliente: o cliente falha, tenta de novo, e só depois de aceito o imóvel sai", async () => {
    const record = recorder((entity, _id, attempt) => {
      if (entity === "client" && attempt === 1) throw retry();
    });
    const { outbox, clients, properties } = start(record);
    open.push(outbox);
    await ready(outbox);

    enqueue(outbox, "upsertClient", () => clients.insert({ id: "c1" }));
    enqueue(outbox, "upsertProperty", () => properties.insert({ id: "p1", clientId: "c1" }));

    await vi.waitFor(() => expect(record.sent).toContain("client:c1"), { timeout: 5_000 });
    // No backoff do cliente, o imóvel continua parado atrás dele.
    await new Promise((done) => setTimeout(done, 200));
    expect(record.sent).toEqual(["client:c1"]);

    outbox.getOnlineDetector().notifyOnline();
    await vi.waitFor(() => expect(record.sent).toHaveLength(3), { timeout: 10_000 });
    expect(record.sent).toEqual(["client:c1", "client:c1", "property:p1"]);
    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0));
  });

  it("a ordem vale depois de recarregar: a fila guardada sem rede sai cliente antes do imóvel", async () => {
    // Sem rede, todo envio falha (o executor tenta mesmo com `navigator.onLine` falso se a aba está visível).
    const offline = recorder(() => {
      throw retry();
    });
    const first = start(offline);
    open.push(first.outbox);
    await ready(first.outbox);
    enqueue(first.outbox, "upsertClient", () => first.clients.insert({ id: "c1" }));
    enqueue(first.outbox, "upsertProperty", () => first.properties.insert({ id: "p1", clientId: "c1" }));
    await vi.waitFor(async () => {
      const pending = await first.outbox.peekOutbox();
      expect(pending.map((transaction) => transaction.retryCount > 0)).toEqual([true, false]);
    });
    first.outbox.dispose();
    open = [];
    // A página antiga solta o lock de líder antes de a nova pedir.
    await new Promise((done) => setTimeout(done, 0));
    expect(new Set(offline.sent)).toEqual(new Set(["client:c1"]));

    // Recarregar: uma outbox nova sobre o mesmo armazenamento, agora com rede.
    const record = recorder(() => {});
    const second = start(record);
    open.push(second.outbox);
    await ready(second.outbox);
    second.outbox.getOnlineDetector().notifyOnline();

    await vi.waitFor(() => expect(record.sent).toHaveLength(2), { timeout: 10_000 });
    expect(record.sent).toEqual(["client:c1", "property:p1"]);
  });
});
