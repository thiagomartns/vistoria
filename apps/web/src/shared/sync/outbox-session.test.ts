import type { OnlineDetector } from "@tanstack/offline-transactions";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "../api/client";
import { refreshToken, signIn } from "../api/generated";
import { resetSession, sessionStore, signInWithPassword } from "../auth/session";
import { RetryableSyncError, ownerOnlineDetector, syncFailure } from "./outbox";

// A outbox e a sessão: sem token, ou com o token de outro usuário, a fila não sai.

vi.mock("../api/generated", async (original) => ({
  ...(await original<typeof import("../api/generated")>()),
  signIn: vi.fn<() => unknown>(),
  refreshToken: vi.fn<() => unknown>(),
}));

/** Um JWT só com o `sub`: a sessão confere de quem é o token que o refresh trouxe. */
const tokenOf = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

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
  vi.mocked(refreshToken).mockReset();
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

describe("volta da rede", () => {
  it("o refresh sai antes de o executor ver a fila online", async () => {
    await enter(ana);
    const network = fakeNetwork();
    const detector = ownerOnlineDetector(ana.id, network);
    const seen: boolean[] = [];
    detector.subscribe(() => seen.push(detector.isOnline()));
    let release = () => {};
    vi.mocked(refreshToken).mockImplementation(
      () =>
        new Promise((done) => {
          release = () =>
            done({
              data: { accessToken: tokenOf(ana.id), expiresAt: "2026-10-31T15:00:00Z" },
            });
        }) as never,
    );

    window.dispatchEvent(new Event("offline"));
    network.notifyOnline();

    expect(refreshToken).toHaveBeenCalledOnce();
    expect(detector.isOnline()).toBe(false);
    expect(seen).toEqual([false]);

    release();
    await vi.waitFor(() => expect(seen.at(-1)).toBe(true));
    expect(accessToken.get()).toBe(tokenOf(ana.id));
  });

  it("sem a rede ter caído (a página voltou a ficar visível), não renova", async () => {
    await enter(ana);
    const network = fakeNetwork();
    const detector = ownerOnlineDetector(ana.id, network);
    const callback = vi.fn<() => void>();
    detector.subscribe(callback);

    network.notifyOnline();

    expect(refreshToken).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledOnce();
    expect(detector.isOnline()).toBe(true);
  });
});

describe("syncFailure com unauthorized", () => {
  it("o client já tentou renovar: expira a sessão e a transação fica na fila", async () => {
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
