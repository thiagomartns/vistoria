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
  it("com Web Locks, roda dentro do lock auth-refresh", async () => {
    const locks = {
      request: vi.fn<(name: string, fn: () => Promise<unknown>) => Promise<unknown>>((_name, fn) =>
        fn(),
      ),
    };
    const lock = createRefreshLock({ locks: locks as never, channel: fakeChannel() });

    expect(await lock.run(async () => "renovado")).toBe("renovado");
    expect(locks.request).toHaveBeenCalledWith(REFRESH_LOCK, expect.any(Function));
  });

  it("sem Web Locks, roda direto", async () => {
    const lock = createRefreshLock({ locks: null, channel: fakeChannel() });

    expect(await lock.run(async () => "renovado")).toBe("renovado");
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
