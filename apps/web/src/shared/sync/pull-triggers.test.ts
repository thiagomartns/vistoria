import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Outbox } from "./outbox";
import { PULL_INTERVAL_MS, startPull } from "./pull-triggers";
import { resetSyncStatus, trackOutbox } from "./sync-status";

// Os gatilhos do pull (frontend.md, "Leitura (pull)") com timers falsos: cada um dispara um ciclo, só com a sessão do
// dono, e um gatilho durante um ciclo não abre outro em paralelo.

const session = vi.hoisted(() => ({ active: true, listeners: new Set<() => void>() }));

vi.mock("../auth/session", () => ({
  canSendAs: (ownerId: string) => session.active && ownerId === "ana",
  sessionStore: {
    subscribe: (listener: () => void) => {
      session.listeners.add(listener);
      return () => session.listeners.delete(listener);
    },
  },
}));

const setSession = (active: boolean) => {
  session.active = active;
  for (const listener of session.listeners) listener();
};

/** Os rascunhos: só a assinatura, para o teste mandar uma exclusão. */
function fakeDrafts() {
  let notify: ((changes: { type: string }[]) => void) | undefined;
  const unsubscribe = vi.fn<() => void>();
  return {
    drafts: {
      subscribeChanges: (callback: (changes: { type: string }[]) => void) => {
        notify = callback;
        return { unsubscribe };
      },
    } as never,
    emit: (...types: string[]) => notify?.(types.map((type) => ({ type }))),
    unsubscribe,
  };
}

/** Um `run` que só termina quando o teste solta. */
function gatedRun() {
  const releases: (() => void)[] = [];
  const run = vi.fn<() => Promise<unknown>>(
    () => new Promise<void>((done) => releases.push(() => done())),
  );
  const finishAll = async () => {
    while (releases.length > 0) {
      releases.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  return { run, finishAll };
}

let visibility: DocumentVisibilityState = "visible";
let stops: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  session.active = true;
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  resetSyncStatus();
  session.listeners.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(run: () => Promise<unknown>, drafts = fakeDrafts().drafts) {
  const pull = startPull({ ownerId: "ana", run, drafts });
  stops.push(pull.dispose);
  return pull;
}

describe("startPull", () => {
  it("abrir com a sessão ativa puxa na hora; sem ela, espera a sessão do dono voltar", async () => {
    const { run, finishAll } = gatedRun();
    start(run);
    expect(run).toHaveBeenCalledOnce();
    await finishAll();

    stops.pop()!();
    setSession(false);
    const other = gatedRun();
    start(other.run);
    expect(other.run).not.toHaveBeenCalled();

    setSession(true);
    expect(other.run).toHaveBeenCalledOnce();
  });

  it("a cada 60 s com o app visível; oculto, o intervalo não puxa", async () => {
    const { run, finishAll } = gatedRun();
    start(run);
    await finishAll();

    await vi.advanceTimersByTimeAsync(PULL_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    await finishAll();

    visibility = "hidden";
    await vi.advanceTimersByTimeAsync(PULL_INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a rede voltar puxa", async () => {
    const { run, finishAll } = gatedRun();
    start(run);
    await finishAll();

    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a outbox esvaziar puxa", async () => {
    const queued = [
      {
        id: "t1",
        mutationFnName: "upsertClient",
        mutations: [],
        createdAt: new Date(),
        retryCount: 0,
        nextAttemptAt: 0,
      },
    ];
    let entries: unknown[] = queued;
    trackOutbox({ peekOutbox: async () => entries, getRunningCount: () => 0 } as unknown as Outbox);
    const { run, finishAll } = gatedRun();
    start(run);
    await vi.advanceTimersByTimeAsync(1_000);
    await finishAll();
    expect(run).toHaveBeenCalledOnce();

    entries = [];
    await vi.advanceTimersByTimeAsync(1_000);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("um rascunho sair do aparelho puxa; outras mudanças nos rascunhos não", async () => {
    const { drafts, emit } = fakeDrafts();
    const { run, finishAll } = gatedRun();
    start(run, drafts);
    await finishAll();

    emit("insert", "update");
    expect(run).toHaveBeenCalledOnce();

    emit("delete");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gatilhos durante um ciclo não abrem outro em paralelo: viram um ciclo só, depois do atual", async () => {
    const { drafts, emit } = fakeDrafts();
    const { run, finishAll } = gatedRun();
    start(run, drafts);

    emit("delete");
    emit("delete");
    await vi.advanceTimersByTimeAsync(PULL_INTERVAL_MS);
    expect(run).toHaveBeenCalledOnce();

    await finishAll();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("um ciclo que falha não para os gatilhos", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi
      .fn<() => Promise<unknown>>(async () => "done")
      .mockRejectedValueOnce(new Error("quebrou"));
    start(run);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(PULL_INTERVAL_MS);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("dispose para o intervalo, a rede, a sessão e os rascunhos", async () => {
    const { drafts, emit, unsubscribe } = fakeDrafts();
    const { run, finishAll } = gatedRun();
    const pull = start(run, drafts);
    await finishAll();

    pull.dispose();
    emit("delete");
    setSession(false);
    setSession(true);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(PULL_INTERVAL_MS);

    expect(run).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
