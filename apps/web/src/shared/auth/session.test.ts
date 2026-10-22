import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "../api/client";
import { signIn, signUp } from "../api/generated";
import {
  canSendAs,
  expireSession,
  resetSession,
  sessionStore,
  signInWithPassword,
  signOutSession,
  signUpWithPassword,
} from "./session";

vi.mock("../api/generated", async (original) => ({
  ...(await original<typeof import("../api/generated")>()),
  signIn: vi.fn<() => unknown>(),
  signUp: vi.fn<() => unknown>(),
}));

const user = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Thiago Martins" };
const other = { id: "0199a0b2-7c1e-7f3a-9b2d-ffffffffffff", name: "Ana Souza" };
const auth = (who = user) =>
  ({ data: { accessToken: "token", expiresAt: "2026-10-22T15:00:00Z", user: who } }) as never;

afterEach(() => {
  resetSession();
  localStorage.clear();
  vi.mocked(signIn).mockReset();
  vi.mocked(signUp).mockReset();
});

describe("sessão", () => {
  it("sem ninguém no aparelho: signed-out, já lida do localStorage", () => {
    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "signed-out", user: null });
    expect(sessionStore.getServerSnapshot()).toMatchObject({ ready: false });
  });

  it("entrar ativa a sessão, guarda o dono (sem o token) e avisa quem assina", async () => {
    vi.mocked(signIn).mockResolvedValue(auth());
    const listener = vi.fn<() => void>();
    sessionStore.subscribe(listener);

    expect(await signInWithPassword("t@exemplo.com", "senha-longa")).toBeNull();

    expect(accessToken.get()).toBe("token");
    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "active", user });
    expect(JSON.parse(localStorage.getItem("vistoria.owner") ?? "")).toEqual(user);
    expect(localStorage.getItem("vistoria.owner")).not.toContain("token");
    expect(listener).toHaveBeenCalled();
  });

  it("criar conta também entra", async () => {
    vi.mocked(signUp).mockResolvedValue(auth());

    expect(await signUpWithPassword("Thiago Martins", "t@exemplo.com", "senha-longa")).toBeNull();

    expect(vi.mocked(signUp).mock.calls[0]?.[0]).toMatchObject({
      body: { name: "Thiago Martins", email: "t@exemplo.com", password: "senha-longa" },
    });
    expect(sessionStore.getSnapshot().status).toBe("active");
  });

  it("falha no signin não abre sessão", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: new TypeError("Failed to fetch") } as never);

    expect(await signInWithPassword("t@exemplo.com", "senha-longa")).toMatchObject({
      kind: "network",
    });
    expect(sessionStore.getSnapshot().status).toBe("signed-out");
    expect(localStorage.getItem("vistoria.owner")).toBeNull();
  });

  it("recarregar perde o token e mantém o dono: expired", async () => {
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");

    resetSession();

    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "expired", user });
  });

  it("dono ilegível no localStorage conta como ninguém", () => {
    localStorage.setItem("vistoria.owner", '{"id":"não é uuid"}');

    expect(sessionStore.getSnapshot().status).toBe("signed-out");
  });

  it("a API recusou o token: expira, mantém o dono", async () => {
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");

    expireSession();

    expect(accessToken.get()).toBeNull();
    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "expired", user });
  });

  it("sair esquece o token e o dono", async () => {
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");

    signOutSession();

    expect(accessToken.get()).toBeNull();
    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "signed-out", user: null });
    expect(localStorage.getItem("vistoria.owner")).toBeNull();
  });

  it("só a sessão ativa do próprio dono envia a fila dele", async () => {
    expect(canSendAs(user.id)).toBe(false);

    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");
    expect(canSendAs(user.id)).toBe(true);
    expect(canSendAs(other.id)).toBe(false);

    expireSession();
    expect(canSendAs(user.id)).toBe(false);

    vi.mocked(signIn).mockResolvedValue(auth(other));
    await signInWithPassword("ana@exemplo.com", "senha-longa");
    expect(canSendAs(user.id)).toBe(false);
    expect(canSendAs(other.id)).toBe(true);
  });
});
