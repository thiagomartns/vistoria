import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type Outbox,
  type OutboxMutationFn,
  RejectedSyncError,
  RetryableSyncError,
  compacting,
  enqueue,
  markAttempted,
  startOutbox,
  wasAttempted,
} from "./outbox";

// Compactação (frontend.md, "Escrita (push)"): das transações do mesmo registro que nunca foram enviadas, só a mais
// recente sai; a que já teve tentativa sai sempre, com a mesma chave, porque pode ter sido aplicada.

let canSend = true;

vi.mock("../auth/session", () => ({
  canSendAs: () => canSend,
  sessionStore: { subscribe: () => () => {} },
  expireSession: () => {},
}));

// Web Locks mínimo, como em outbox.order.test.ts: sem líder, a outbox não guarda a fila.
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

const retry = () =>
  new RetryableSyncError("retry", { kind: "network", cause: new TypeError("Failed to fetch") });

const rejected = () =>
  new RejectedSyncError("back-to-draft", {
    kind: "problem",
    problem: {
      type: "urn:vistoria:problem:validation",
      title: "validation",
      status: 400,
      detail: "",
      traceId: "",
    },
  });

describe("compacting", () => {
  const queued = (
    entries: {
      id: string;
      keys?: string[];
      createdAt?: number;
      retryCount?: number;
      mutationFnName?: string;
    }[],
  ) =>
    ({
      peekOutbox: async () =>
        entries.map((entry) => ({
          mutationFnName: "upsertInspection",
          keys: ["inspections:i1"],
          retryCount: 0,
          ...entry,
          createdAt: new Date(entry.createdAt ?? 0),
        })),
    }) as unknown as Outbox;

  const params = (id: string, idempotencyKey: string) =>
    ({ transaction: { id, mutations: [] }, idempotencyKey }) as never;

  afterEach(() => localStorage.clear());

  it("nunca tentada, com uma mais nova do mesmo registro na fila: termina sem enviar", async () => {
    const send = vi.fn<() => Promise<void>>(async () => {});
    const outbox = queued([
      { id: "t1", createdAt: 1 },
      { id: "t2", createdAt: 2 },
    ]);

    await compacting(send, () => outbox)(params("t1", "k1"));

    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "é a mais nova da fila",
      [
        { id: "t1", createdAt: 2 },
        { id: "t0", createdAt: 1 },
      ],
    ],
    [
      "a outra é de outro registro",
      [
        { id: "t1", createdAt: 1 },
        { id: "t2", createdAt: 2, keys: ["inspections:i2"] },
      ],
    ],
    [
      "a outra é de outro envio",
      [
        { id: "t1", createdAt: 1 },
        { id: "t2", createdAt: 2, mutationFnName: "upsertClient" },
      ],
    ],
    [
      "as duas têm o mesmo createdAt (ordem não garantida)",
      [
        { id: "t1", createdAt: 1 },
        { id: "t2", createdAt: 1 },
      ],
    ],
    [
      "já falhou uma vez (retryCount)",
      [
        { id: "t1", createdAt: 1, retryCount: 1 },
        { id: "t2", createdAt: 2 },
      ],
    ],
    ["não está na outbox (aba sem liderança)", [{ id: "t2", createdAt: 2 }]],
  ])("envia quando %s", async (_case, entries) => {
    const send = vi.fn<() => Promise<void>>(async () => {});

    await compacting(send, () => queued(entries))(params("t1", "k1"));

    expect(send).toHaveBeenCalledOnce();
  });

  it("nunca tentada, com uma exclusão mais nova do mesmo registro na fila: termina sem enviar", async () => {
    const send = vi.fn<() => Promise<void>>(async () => {});
    const outbox = queued([
      { id: "t1", createdAt: 1 },
      { id: "t2", createdAt: 2, mutationFnName: "deleteInspection" },
    ]);

    await compacting(send, () => outbox, new Set(["deleteInspection"]))(params("t1", "k1"));

    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "já foi tentada",
      [
        { id: "t1", createdAt: 1, retryCount: 1 },
        { id: "t2", createdAt: 2, mutationFnName: "deleteInspection" },
      ],
    ],
    [
      "a exclusão é de outro registro",
      [
        { id: "t1", createdAt: 1 },
        { id: "t2", createdAt: 2, mutationFnName: "deleteInspection", keys: ["inspections:i2"] },
      ],
    ],
    [
      "a exclusão é mais antiga",
      [
        { id: "t0", createdAt: 0, mutationFnName: "deleteInspection" },
        { id: "t1", createdAt: 1 },
      ],
    ],
  ])("com uma exclusão na fila, envia quando %s", async (_case, entries) => {
    const send = vi.fn<() => Promise<void>>(async () => {});

    await compacting(
      send,
      () => queued(entries),
      new Set(["deleteInspection"]),
    )(params("t1", "k1"));

    expect(send).toHaveBeenCalledOnce();
  });

  it("removalQueued: diz ao envio se há outra exclusão do mesmo registro na fila", async () => {
    const answers: boolean[] = [];
    const send = vi.fn<OutboxMutationFn<any>>(async ({ removalQueued }) => {
      answers.push(await removalQueued!());
    });
    const removals = new Set(["deleteInspection"]);

    await compacting(
      send,
      () =>
        queued([
          { id: "t1", createdAt: 1, retryCount: 1 },
          { id: "t2", createdAt: 2, mutationFnName: "deleteInspection" },
        ]),
      removals,
    )(params("t1", "k1"));
    await compacting(
      send,
      () =>
        queued([
          { id: "t1", createdAt: 1 },
          { id: "t2", createdAt: 2, mutationFnName: "deleteInspection", keys: ["inspections:i2"] },
        ]),
      removals,
    )(params("t1", "k2"));
    await compacting(
      send,
      () => queued([{ id: "t1", createdAt: 1, mutationFnName: "deleteInspection" }]),
      removals,
    )(params("t1", "k3"));

    expect(answers).toEqual([true, false, false]);
  });

  it("aba fechada no meio do envio (marca gravada, retryCount 0): reenvia, não compacta", async () => {
    const send = vi.fn<() => Promise<void>>(async () => {});
    markAttempted("k1");

    await compacting(send, () =>
      queued([
        { id: "t1", createdAt: 1 },
        { id: "t2", createdAt: 2 },
      ]),
    )(params("t1", "k1"));

    expect(send).toHaveBeenCalledOnce();
  });

  it("a marca é gravada antes do envio e apagada no sucesso e na recusa; numa falha que volta para a fila, fica", async () => {
    const outbox = () => queued([{ id: "t1" }]);
    let markedDuringSend = false;
    await compacting(async () => {
      markedDuringSend = wasAttempted("ok");
    }, outbox)(params("t1", "ok"));
    expect(markedDuringSend).toBe(true);
    expect(wasAttempted("ok")).toBe(false);

    await expect(
      compacting(async () => Promise.reject(rejected()), outbox)(params("t1", "no")),
    ).rejects.toBeInstanceOf(RejectedSyncError);
    expect(wasAttempted("no")).toBe(false);

    await expect(
      compacting(async () => Promise.reject(retry()), outbox)(params("t1", "again")),
    ).rejects.toBeInstanceOf(RetryableSyncError);
    expect(wasAttempted("again")).toBe(true);
  });
});

type Row = { id: string; n: number };

describe("outbox com compactação", () => {
  let open: Outbox[] = [];

  afterEach(() => {
    for (const outbox of open) outbox.dispose();
    open = [];
    canSend = true;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** Uma outbox de verdade que anota o `n` de cada envio e responde pelo `answer`. */
  async function start(answer: (attempt: number) => void = () => {}) {
    const sent: number[] = [];
    const bodies: unknown[] = [];
    const rows = createCollection(
      localOnlyCollectionOptions<Row, string>({ id: "rows", getKey: (row) => row.id }),
    );
    const outbox = startOutbox({
      ownerId: "ana",
      collections: { rows },
      mutationFns: {
        upsertRow: async ({
          transaction,
        }: {
          transaction: { mutations: { modified: unknown }[] };
        }) => {
          bodies.push(transaction.mutations[0]!.modified);
          sent.push((transaction.mutations[0]!.modified as Row).n);
          answer(sent.length);
        },
      },
    });
    open.push(outbox);
    await outbox.waitForInit();
    await vi.waitFor(() => expect(outbox.isOfflineEnabled).toBe(true));
    const edit = (n: number) =>
      enqueue(outbox, "upsertRow", () => {
        if (rows.has("r1")) rows.update("r1", (row) => void (row.n = n));
        else rows.insert({ id: "r1", n });
      });
    const reconnect = () => {
      canSend = true;
      outbox.getOnlineDetector().notifyOnline();
    };
    return { outbox, sent, bodies, edit, reconnect };
  }

  it("três edições nunca enviadas: sai só a última, com o registro inteiro", async () => {
    canSend = false;
    const { outbox, sent, bodies, edit, reconnect } = await start();

    edit(1);
    // createdAt em ms: um tique entre as edições, como entre dois toques na tela.
    await new Promise((done) => setTimeout(done, 5));
    edit(2);
    await new Promise((done) => setTimeout(done, 5));
    edit(3);
    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(3));
    reconnect();

    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), {
      timeout: 5_000,
    });
    expect(sent).toEqual([3]);
    expect(bodies).toEqual([{ id: "r1", n: 3 }]);
  });

  it("a que já foi tentada sai de novo; das de trás, só a última, encadeada depois dela", async () => {
    const { outbox, sent, edit, reconnect } = await start((attempt) => {
      if (attempt === 1) throw retry();
    });

    edit(1);
    await vi.waitFor(() => expect(sent).toEqual([1]), { timeout: 5_000 });
    canSend = false;
    edit(2);
    await new Promise((done) => setTimeout(done, 5));
    edit(3);
    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(3));
    reconnect();

    await vi.waitFor(async () => expect(await outbox.peekOutbox()).toHaveLength(0), {
      timeout: 10_000,
    });
    expect(sent).toEqual([1, 1, 3]);
  });
});
