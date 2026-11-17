import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { refreshToken } from "../api/generated";
import { resetSession, sessionStore } from "./session";
import { useSessionGuard } from "./useSessionGuard";

// O guard do shell com a sessão de verdade: só o refresh recusado manda para o /login. O 429 (ou 5xx) da abertura
// deixa a sessão `renewing` até a próxima tentativa (#210, ADR 0062).

const navigation = vi.hoisted(() => ({ replace: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn<() => void>() }),
}));

vi.mock("../api/generated", async (original) => ({
  ...(await original<typeof import("../api/generated")>()),
  refreshToken: vi.fn<() => unknown>(),
}));

const user = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Thiago Martins" };
const token = `h.${btoa(JSON.stringify({ sub: user.id })).replace(/=+$/, "")}.s`;

const problem = (type: string, status: number, headers: Record<string, string> = {}) =>
  ({
    error: {
      type: `urn:vistoria:problem:${type}`,
      title: type,
      status,
      detail: type,
      traceId: "00-trace",
    },
    response: new Response(null, { status, headers }),
  }) as never;

/** Um reload em /inspections: o dono no localStorage, sem token, e o shell montando o guard. */
function openShell() {
  localStorage.setItem("vistoria.owner", JSON.stringify(user));
  resetSession();
  window.history.replaceState(null, "", "/inspections");
  return renderHook(() => useSessionGuard(false));
}

afterEach(() => {
  resetSession();
  localStorage.clear();
  vi.useRealTimers();
  vi.mocked(refreshToken).mockReset();
  navigation.replace.mockReset();
});

describe("useSessionGuard na abertura", () => {
  it("429 no refresh não manda para o /login; o 200 seguinte, depois do Retry-After, fica active", async () => {
    vi.useFakeTimers();
    vi.mocked(refreshToken).mockResolvedValue(
      problem("rate-limited", 429, { "Retry-After": "20" }),
    );
    openShell();

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(sessionStore.getSnapshot().status).toBe("renewing");
    expect(navigation.replace).not.toHaveBeenCalled();

    vi.mocked(refreshToken).mockResolvedValue({
      data: { accessToken: token, expiresAt: "2026-11-16T15:00:00Z" },
    } as never);
    await act(() => vi.advanceTimersByTimeAsync(20_000));

    expect(refreshToken).toHaveBeenCalledTimes(2);
    expect(sessionStore.getSnapshot().status).toBe("active");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("5xx no refresh também não manda para o /login", async () => {
    vi.useFakeTimers();
    vi.mocked(refreshToken).mockResolvedValue(problem("internal", 500));
    openShell();

    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(sessionStore.getSnapshot().status).toBe("renewing");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("o refresh recusado (401) manda para o /login, de volta para a tela de antes", async () => {
    vi.mocked(refreshToken).mockResolvedValue(problem("unauthorized", 401));
    openShell();

    await vi.waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/login?next=%2Finspections"),
    );
    expect(sessionStore.getSnapshot().status).toBe("expired");
  });
});
