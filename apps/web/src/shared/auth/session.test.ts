import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "../api/client";
import { refreshToken, signIn, signUp } from "../api/generated";
import {
  canSendAs,
  expireSession,
  lastRenewedAt,
  renewAfterReconnect,
  renewSession,
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
  refreshToken: vi.fn<() => unknown>(),
}));

const user = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Thiago Martins" };
const other = { id: "0199a0b2-7c1e-7f3a-9b2d-ffffffffffff", name: "Ana Souza" };
const auth = (who = user) =>
  ({ data: { accessToken: "token", expiresAt: "2026-10-22T15:00:00Z", user: who } }) as never;

/** Um JWT só com o `sub`: a sessão confere de quem é o token que o refresh trouxe. */
const tokenOf = (sub: string, n = 1) =>
  `h${n}.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

const refreshed = (who = user, n = 1) =>
  ({ data: { accessToken: tokenOf(who.id, n), expiresAt: "2026-10-31T15:00:00Z" } }) as never;

const problem = (type: string, status: number) =>
  ({
    error: {
      type: `urn:vistoria:problem:${type}`,
      title: type,
      status,
      detail: type,
      traceId: "00-trace",
    },
    response: new Response(null, { status }),
  }) as never;

/** Como depois de um reload: o dono no localStorage, sem token. */
function reloaded(who = user) {
  localStorage.setItem("vistoria.owner", JSON.stringify(who));
  resetSession();
}

function setNetwork(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

/** Assina o store, como o `useSession`: instala os gatilhos e faz a renovação da abertura. */
const subscribe = () => sessionStore.subscribe(() => {});

afterEach(() => {
  resetSession();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.mocked(signIn).mockReset();
  vi.mocked(signUp).mockReset();
  vi.mocked(refreshToken).mockReset();
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

  it("recarregar perde o token e mantém o dono: com rede, renewing (o refresh decide)", async () => {
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");

    resetSession();

    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "renewing", user });
    expect(canSendAs(user.id)).toBe(false);
  });

  it("recarregar sem rede: expired, sem refresh", () => {
    setNetwork(false);
    reloaded();
    subscribe();

    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "expired", user });
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it("entrar grava a data da renovação (de onde conta a janela offline)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00Z"), toFake: ["Date"] });
    vi.mocked(signIn).mockResolvedValue(auth());

    expect(lastRenewedAt()).toBeNull();
    await signInWithPassword("t@exemplo.com", "senha-longa");

    expect(lastRenewedAt()).toEqual(new Date("2026-10-31T12:00:00Z"));
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

describe("renovação", () => {
  it("recarregou com rede e cookie válido: renova e volta ativa, sem passar por expired", async () => {
    const start = Date.now();
    vi.mocked(refreshToken).mockResolvedValue(refreshed());
    reloaded();
    const seen: string[] = [];
    sessionStore.subscribe(() => seen.push(sessionStore.getSnapshot().status));

    await vi.waitFor(() => expect(sessionStore.getSnapshot().status).toBe("active"));

    expect(refreshToken).toHaveBeenCalledOnce();
    expect(accessToken.get()).toBe(tokenOf(user.id));
    expect(seen).not.toContain("expired");
    expect(canSendAs(user.id)).toBe(true);
    expect(lastRenewedAt()!.getTime()).toBeGreaterThanOrEqual(start);
  });

  it("sem navigator.locks (o jsdom não tem): renova do mesmo jeito", async () => {
    expect("locks" in navigator).toBe(false);
    vi.mocked(refreshToken).mockResolvedValue(refreshed());
    reloaded();
    subscribe();

    await vi.waitFor(() => expect(sessionStore.getSnapshot().status).toBe("active"));
  });

  it("dois pedidos na mesma aba: um refresh só", async () => {
    vi.mocked(refreshToken).mockResolvedValue(refreshed());
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");

    const outcomes = await Promise.all([renewSession(), renewSession()]);

    expect(outcomes).toEqual(["renewed", "renewed"]);
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  it("refresh recusado (401): expired, o dono fica e a fila não sai", async () => {
    vi.mocked(refreshToken).mockResolvedValue(problem("unauthorized", 401));
    reloaded();
    subscribe();

    await vi.waitFor(() => expect(sessionStore.getSnapshot().status).toBe("expired"));

    expect(sessionStore.getSnapshot().user).toEqual(user);
    expect(localStorage.getItem("vistoria.owner")).not.toBeNull();
    expect(canSendAs(user.id)).toBe(false);
  });

  it("refresh recusado no meio da sessão: o token velho some", async () => {
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");
    vi.mocked(refreshToken).mockResolvedValue(problem("unauthorized", 401));

    expect(await renewSession()).toBe("expired");

    expect(accessToken.get()).toBeNull();
    expect(sessionStore.getSnapshot().status).toBe("expired");
  });

  it.each([
    ["sem resposta", { error: new TypeError("Failed to fetch") } as never],
    ["429", problem("rate-limited", 429)],
    ["5xx", problem("internal", 500)],
  ])("refresh %s: offline, sem expirar (o token de antes fica)", async (_label, answer) => {
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");
    vi.mocked(refreshToken).mockResolvedValue(answer);

    expect(await renewSession()).toBe("offline");

    expect(accessToken.get()).toBe("token");
    expect(sessionStore.getSnapshot().status).toBe("active");
  });

  it("o cookie trouxe o token de outro usuário: não vale para este dono", async () => {
    vi.mocked(refreshToken).mockResolvedValue(refreshed(other));
    reloaded();
    subscribe();

    await vi.waitFor(() => expect(sessionStore.getSnapshot().status).toBe("expired"));

    expect(accessToken.get()).toBeNull();
    expect(canSendAs(user.id)).toBe(false);
    expect(canSendAs(other.id)).toBe(false);
  });

  it("saiu durante o refresh: o resultado é descartado", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(refreshToken).mockImplementation(
      () => new Promise((done) => (answer = done)) as never,
    );
    reloaded();
    subscribe();

    signOutSession();
    answer(refreshed());

    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalled());
    await new Promise((done) => setTimeout(done, 0));
    expect(accessToken.get()).toBeNull();
    expect(sessionStore.getSnapshot()).toEqual({ ready: true, status: "signed-out", user: null });
  });

  it("a rede caiu e voltou: renova; sem ter caído, renewAfterReconnect não faz nada", async () => {
    vi.mocked(signIn).mockResolvedValue(auth());
    await signInWithPassword("t@exemplo.com", "senha-longa");
    vi.mocked(refreshToken).mockResolvedValue(refreshed());
    subscribe();

    renewAfterReconnect();
    expect(refreshToken).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));

    expect(sessionStore.getSnapshot().status).toBe("renewing");
    expect(canSendAs(user.id)).toBe(false);
    await vi.waitFor(() => expect(sessionStore.getSnapshot().status).toBe("active"));
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(accessToken.get()).toBe(tokenOf(user.id));

    // Uma volta, uma renovação: outro gatilho da mesma volta não pede outra.
    renewAfterReconnect();
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  it("abriu sem rede: a rede voltar renova", async () => {
    setNetwork(false);
    reloaded();
    subscribe();
    vi.mocked(refreshToken).mockResolvedValue(refreshed());

    setNetwork(true);
    window.dispatchEvent(new Event("online"));

    await vi.waitFor(() => expect(sessionStore.getSnapshot().status).toBe("active"));
  });
});
