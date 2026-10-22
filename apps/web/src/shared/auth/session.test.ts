// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "../api/client";
import { signIn } from "../api/generated";
import { sessionStore, signInWithPassword, signOutSession } from "./session";

vi.mock("../api/generated", async (original) => ({
  ...(await original<typeof import("../api/generated")>()),
  signIn: vi.fn<() => unknown>(),
}));

const user = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Thiago Martins" };

afterEach(() => {
  signOutSession();
  vi.mocked(signIn).mockReset();
});

describe("sessão", () => {
  it("entrar guarda o token e quem entrou, e avisa quem assina", async () => {
    vi.mocked(signIn).mockResolvedValue({
      data: { accessToken: "token", expiresAt: "2026-10-22T15:00:00Z", user },
    } as never);
    const listener = vi.fn<() => void>();
    sessionStore.subscribe(listener);

    expect(await signInWithPassword("t@exemplo.com", "senha-longa")).toBeNull();

    expect(accessToken.get()).toBe("token");
    expect(sessionStore.getSnapshot()).toEqual(user);
    expect(listener).toHaveBeenCalled();
  });

  it("falha no signin não abre sessão", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: new TypeError("Failed to fetch") } as never);

    expect(await signInWithPassword("t@exemplo.com", "senha-longa")).toMatchObject({
      kind: "network",
    });
    expect(sessionStore.getSnapshot()).toBeNull();
  });

  it("sair esquece o token e o usuário", async () => {
    vi.mocked(signIn).mockResolvedValue({
      data: { accessToken: "token", expiresAt: "2026-10-22T15:00:00Z", user },
    } as never);
    await signInWithPassword("t@exemplo.com", "senha-longa");

    signOutSession();

    expect(accessToken.get()).toBeNull();
    expect(sessionStore.getSnapshot()).toBeNull();
  });
});
