import { describe, expect, it, vi } from "vitest";

import { REFRESH_LOCK, createRefreshLock } from "./refreshLock";

function fakeChannel() {
  return {
    postMessage: vi.fn<(message: unknown) => void>(),
    close: vi.fn<() => void>(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  };
}

describe("createRefreshLock", () => {
  it("com Web Locks e o lock livre, roda dentro do lock auth-refresh, sem contenção", async () => {
    const locks = {
      request: vi.fn<
        (name: string, options: LockOptions, fn: (lock: Lock | null) => unknown) => Promise<unknown>
      >(async (name, _options, fn) => fn({ name, mode: "exclusive" })),
    };
    const lock = createRefreshLock({ locks: locks as never, channel: fakeChannel() });

    const run = vi.fn<(contended: boolean) => Promise<string>>(async () => "renovado");
    expect(await lock.run(run)).toBe("renovado");
    expect(run).toHaveBeenCalledWith(false);
    expect(locks.request).toHaveBeenCalledOnce();
    expect(locks.request).toHaveBeenCalledWith(REFRESH_LOCK, { ifAvailable: true }, expect.any(Function));
  });

  it("com o lock em outra aba, espera ele e roda com contenção (#190)", async () => {
    const calls: unknown[][] = [];
    const locks = {
      request: async (...args: unknown[]) => {
        calls.push(args);
        if (args.length === 3) return (args[2] as (lock: Lock | null) => unknown)(null);
        return (args[1] as (lock: Lock | null) => unknown)({ name: REFRESH_LOCK, mode: "exclusive" });
      },
    };
    const lock = createRefreshLock({ locks: locks as never, channel: fakeChannel() });

    const run = vi.fn<(contended: boolean) => Promise<string>>(async () => "renovado");
    expect(await lock.run(run)).toBe("renovado");
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(true);
    expect(calls.map((args) => args.length)).toEqual([3, 2]);
  });

  it("sem Web Locks, roda direto, sem contenção", async () => {
    const lock = createRefreshLock({ locks: null, channel: fakeChannel() });

    const run = vi.fn<(contended: boolean) => Promise<string>>(async () => "renovado");
    expect(await lock.run(run)).toBe("renovado");
    expect(run).toHaveBeenCalledWith(false);
  });

  it("anuncia pelo canal e só repassa mensagem com dono e token", () => {
    const channel = fakeChannel();
    const lock = createRefreshLock({ locks: null, channel });
    const listener = vi.fn<(message: unknown) => void>();
    lock.onAnnounce(listener);

    lock.announce({ userId: "u1", accessToken: "t1" });
    expect(channel.postMessage).toHaveBeenCalledWith({ userId: "u1", accessToken: "t1" });

    channel.onmessage?.(new MessageEvent("message", { data: { userId: "u1", accessToken: "t1" } }));
    channel.onmessage?.(new MessageEvent("message", { data: { userId: "u1" } }));
    channel.onmessage?.(new MessageEvent("message", { data: "lixo" }));
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ userId: "u1", accessToken: "t1" });
  });

  it("sem BroadcastChannel, anunciar e ouvir não fazem nada", () => {
    const lock = createRefreshLock({ locks: null, channel: null });

    expect(() => lock.announce({ userId: "u1", accessToken: "t1" })).not.toThrow();
    expect(() => lock.onAnnounce(() => {})).not.toThrow();
    expect(() => lock.close()).not.toThrow();
  });
});
