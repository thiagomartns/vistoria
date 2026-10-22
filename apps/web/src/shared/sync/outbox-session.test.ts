import type { OnlineDetector } from "@tanstack/offline-transactions";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "../api/client";
import { signIn } from "../api/generated";
import { resetSession, sessionStore, signInWithPassword } from "../auth/session";
import { RetryableSyncError, ownerOnlineDetector, syncFailure } from "./outbox";

// A outbox e a sessão: sem token, ou com o token de outro usuário, a fila não sai.

vi.mock("../api/generated", async (original) => ({
  ...(await original<typeof import("../api/generated")>()),
  signIn: vi.fn<() => unknown>(),
}));

const ana = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Ana" };
const bia = { id: "0199a0b2-7c1e-7f3a-9b2d-ffffffffffff", name: "Bia" };

async function enter(user: typeof ana) {
  vi.mocked(signIn).mockResolvedValue({
    data: { accessToken: `token-${user.name}`, expiresAt: "2026-10-22T15:00:00Z", user },
  } as never);
  await signInWithPassword(`${user.name}@exemplo.com`, "senha-longa");
}

type FakeNetwork = OnlineDetector & { online: boolean; dispose: ReturnType<typeof vi.fn> };

function fakeNetwork(online = true): FakeNetwork {
  const listeners = new Set<() => void>();
  const network: FakeNetwork = {
    online,
    subscribe: (callback: () => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    notifyOnline: () => {
      for (const listener of listeners) listener();
    },
    isOnline: () => network.online,
    dispose: vi.fn<() => void>(),
  };
  return network;
}

afterEach(() => {
  resetSession();
  localStorage.clear();
});

describe("ownerOnlineDetector", () => {
  it("parado sem rede, sem token, ou com a sessão de outro usuário", async () => {
    const network = fakeNetwork();
    const detector = ownerOnlineDetector(ana.id, network);
    expect(detector.isOnline()).toBe(false);

    await enter(bia);
    expect(detector.isOnline()).toBe(false);

    await enter(ana);
    expect(detector.isOnline()).toBe(true);

    network.online = false;
    expect(detector.isOnline()).toBe(false);
  });

  it("avisa o executor quando o dono entra, e não quando outro entra", async () => {
    const detector = ownerOnlineDetector(ana.id, fakeNetwork());
    const callback = vi.fn<() => void>();
    detector.subscribe(callback);

    await enter(bia);
    expect(callback).not.toHaveBeenCalled();

    await enter(ana);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("repassa a volta da rede e solta tudo no dispose", async () => {
    const network = fakeNetwork();
    const detector = ownerOnlineDetector(ana.id, network);
    const callback = vi.fn<() => void>();
    detector.subscribe(callback);

    network.notifyOnline();
    expect(callback).toHaveBeenCalledOnce();

    detector.dispose();
    network.notifyOnline();
    await enter(ana);
    expect(callback).toHaveBeenCalledOnce();
    expect(network.dispose).toHaveBeenCalled();
  });
});

describe("syncFailure com unauthorized", () => {
  it("expira a sessão (sem refresh até o M4) e a transação fica na fila", async () => {
    await enter(ana);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const error = syncFailure({
      error: {
        type: "urn:vistoria:problem:unauthorized",
        title: "Não autenticado",
        status: 401,
        detail: "Token expirado.",
        traceId: "00-trace",
      },
      response: new Response(null, { status: 401 }),
    });

    expect(error).toBeInstanceOf(RetryableSyncError);
    expect(accessToken.get()).toBeNull();
    expect(sessionStore.getSnapshot()).toMatchObject({ status: "expired", user: ana });
  });
});
