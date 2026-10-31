import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "@/shared/api/client";
import { signOut } from "@/shared/api/generated";
import { canSendAs, currentOwner, resetSession, sessionStore } from "@/shared/auth/session";

import { enterOnDevice, signOutOnDevice } from "./device-session";
import { pendingOf, wipeLocalStore } from "./local-store";

// Outro usuário, o mesmo usuário e o "Sair" (ADR 0046). O banco local é simulado: aqui importa o que a sessão faz com
// ele (contar, apagar ou não tocar). O roteiro `spike:outbox` confere o IndexedDB de verdade.

vi.mock("./local-store", () => ({
  pendingOf: vi.fn<(ownerId: string) => Promise<number>>(async () => 0),
  wipeLocalStore: vi.fn<(ownerId: string) => Promise<void>>(async () => {}),
}));

vi.mock("@/shared/api/generated", async (original) => ({
  ...(await original<typeof import("@/shared/api/generated")>()),
  signOut: vi.fn<() => unknown>(async () => ({
    data: undefined,
    response: new Response(null, { status: 204 }),
  })),
}));

const ana = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Ana Souza" };
const bia = { id: "0199a0b2-7c1e-7f3a-9b2d-ffffffffffff", name: "Bia Lima" };
const tokenOf = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;
const auth = (who: typeof ana) => ({
  accessToken: tokenOf(who.id),
  expiresAt: "2026-10-31T15:00:00Z",
  user: who,
});

/** Como depois de um refresh recusado: `ana` é a dona, sem token. */
function expiredOwner(who = ana) {
  localStorage.setItem("vistoria.owner", JSON.stringify(who));
  resetSession();
}

afterEach(() => {
  resetSession();
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(pendingOf).mockResolvedValue(0);
});

describe("enterOnDevice", () => {
  it("sem dono no aparelho: entra direto", async () => {
    expect(await enterOnDevice(auth(ana))).toBeNull();

    expect(currentOwner()).toEqual(ana);
    expect(sessionStore.getSnapshot().status).toBe("active");
    expect(wipeLocalStore).not.toHaveBeenCalled();
  });

  it("o mesmo usuário: sem aviso, sem apagar nada, e a fila retoma", async () => {
    expiredOwner();
    vi.mocked(pendingOf).mockResolvedValue(3);

    expect(await enterOnDevice(auth(ana))).toBeNull();

    expect(pendingOf).not.toHaveBeenCalled();
    expect(wipeLocalStore).not.toHaveBeenCalled();
    expect(canSendAs(ana.id)).toBe(true);
  });

  it("outro usuário sem pendências do anterior: apaga o banco dele e entra, sem perguntar", async () => {
    expiredOwner();

    expect(await enterOnDevice(auth(bia))).toBeNull();

    expect(wipeLocalStore).toHaveBeenCalledExactlyOnceWith(ana.id);
    expect(currentOwner()).toEqual(bia);
    expect(canSendAs(bia.id)).toBe(true);
  });

  it("outro usuário com pendências: devolve o aviso com o número, e o token novo não vira sessão", async () => {
    expiredOwner();
    vi.mocked(pendingOf).mockResolvedValue(4);

    const decision = await enterOnDevice(auth(bia));

    expect(decision).toMatchObject({ previous: ana, pending: 4 });
    expect(pendingOf).toHaveBeenCalledExactlyOnceWith(ana.id);
    expect(currentOwner()).toEqual(ana);
    expect(accessToken.get()).toBeNull();
    expect(wipeLocalStore).not.toHaveBeenCalled();
  });

  it("confirmar apaga o banco do anterior antes de a sessão nova começar", async () => {
    expiredOwner();
    vi.mocked(pendingOf).mockResolvedValue(4);
    const decision = await enterOnDevice(auth(bia));
    vi.mocked(wipeLocalStore).mockImplementation(async () => {
      expect(currentOwner()).toEqual(ana);
    });

    await decision!.confirm();

    expect(wipeLocalStore).toHaveBeenCalledExactlyOnceWith(ana.id);
    expect(currentOwner()).toEqual(bia);
    expect(canSendAs(bia.id)).toBe(true);
  });

  it("cancelar faz o signOut da conta nova e mantém tudo do anterior", async () => {
    expiredOwner();
    vi.mocked(pendingOf).mockResolvedValue(4);
    const decision = await enterOnDevice(auth(bia));

    await decision!.cancel();

    expect(signOut).toHaveBeenCalledOnce();
    expect(wipeLocalStore).not.toHaveBeenCalled();
    expect(currentOwner()).toEqual(ana);
    expect(accessToken.get()).toBeNull();
    expect(canSendAs(bia.id)).toBe(false);
  });
});

describe("signOutOnDevice", () => {
  it("chama o signOut, apaga o banco do dono e esquece a sessão", async () => {
    await enterOnDevice(auth(ana));

    await signOutOnDevice();

    expect(signOut).toHaveBeenCalledOnce();
    expect(wipeLocalStore).toHaveBeenCalledExactlyOnceWith(ana.id);
    expect(currentOwner()).toBeNull();
    expect(accessToken.get()).toBeNull();
    expect(localStorage.getItem("vistoria.renewed-at")).toBeNull();
  });

  it("sem rede, o signOut falha e a limpeza local acontece mesmo assim", async () => {
    await enterOnDevice(auth(ana));
    vi.mocked(signOut).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(signOutOnDevice()).resolves.toBeUndefined();

    expect(wipeLocalStore).toHaveBeenCalledExactlyOnceWith(ana.id);
    expect(currentOwner()).toBeNull();
  });

  it("a sessão é esquecida antes da limpeza: nenhuma tela reabre o banco do dono no meio", async () => {
    await enterOnDevice(auth(ana));
    vi.mocked(wipeLocalStore).mockImplementation(async () => {
      expect(currentOwner()).toBeNull();
    });

    await signOutOnDevice();

    expect(wipeLocalStore).toHaveBeenCalledOnce();
  });
});
