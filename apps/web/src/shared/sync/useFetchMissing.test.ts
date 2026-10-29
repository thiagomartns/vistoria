import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FetchOutcome } from "./fetch";
import { resetSyncStatus } from "./sync-status";
import { useFetchMissing } from "./useFetchMissing";

// O hook da leitura por id: busca uma vez por id, mostra o estado da busca, busca de novo quando a rede volta e no
// "Tentar de novo", e ignora a resposta de um id que a tela já deixou.

const messages = { offline: "sem rede", notFound: "não existe", failed: "falhou" };

function render(id: string | null, fetch: (id: string) => Promise<FetchOutcome>) {
  return renderHook(({ current }) => useFetchMissing(current, fetch, messages), {
    initialProps: { current: id },
  });
}

afterEach(() => {
  resetSyncStatus();
});

describe("useFetchMissing", () => {
  it("sem id (o registro está no aparelho): não busca", () => {
    const fetch = vi.fn<(id: string) => Promise<FetchOutcome>>(async () => "found");
    const { result } = render(null, fetch);

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current).toEqual({ state: null, unavailable: null });
  });

  it("buscando e gravado: segue `fetching` até o banco local entregar o registro", async () => {
    const fetch = vi.fn<(id: string) => Promise<FetchOutcome>>(async () => "found");
    const { result } = render("c1", fetch);

    expect(result.current.state).toBe("fetching");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("c1"));
    expect(result.current).toEqual({ state: "fetching", unavailable: null });
  });

  it("404: o aviso de não encontrado, sem Tentar de novo", async () => {
    const { result } = render("c1", async () => "not-found");

    await waitFor(() => expect(result.current.state).toBe("not-found"));
    expect(result.current.unavailable).toEqual({ description: "não existe" });
  });

  it("sem rede: busca de novo quando a rede volta", async () => {
    const fetch = vi.fn<(id: string) => Promise<FetchOutcome>>(async () => "offline");
    const { result } = render("c1", fetch);
    await waitFor(() => expect(result.current.state).toBe("offline"));
    expect(result.current.unavailable).toEqual({ description: "sem rede" });

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fetch.mockResolvedValue("found");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.state).toBe("fetching"));
  });

  it("falha do servidor: o Tentar de novo do aviso busca outra vez", async () => {
    const fetch = vi.fn<(id: string) => Promise<FetchOutcome>>(async () => "failed");
    const { result } = render("c1", fetch);
    await waitFor(() => expect(result.current.state).toBe("failed"));

    act(() => result.current.unavailable?.onRetry?.());

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("uma busca que joga: falha", async () => {
    const { result } = render("c1", async () => {
      throw new Error("bug");
    });

    await waitFor(() => expect(result.current.state).toBe("failed"));
  });

  it("a resposta de um id que a tela deixou é ignorada", async () => {
    let answerOld: (outcome: FetchOutcome) => void = () => {};
    const fetch = vi.fn<(id: string) => Promise<FetchOutcome>>((id) =>
      id === "velho"
        ? new Promise((resolve) => {
            answerOld = resolve;
          })
        : new Promise(() => {}),
    );
    const { result, rerender } = render("velho", fetch);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("velho"));

    rerender({ current: "novo" });
    await act(async () => answerOld("not-found"));

    expect(result.current.state).toBe("fetching");
  });
});
