import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "@/shared/api/client";
import { pendingOf, wipeLocalStore } from "@/features/local-store/services/local-store";
import { signIn, signOut } from "@/shared/api/generated";
import { canSendAs, resetSession } from "@/shared/auth/session";
import type { Outbox } from "@/shared/sync/outbox";
import { resetSyncStatus, trackOutbox } from "@/shared/sync/sync-status";

import { SignInScreen } from "./sign-in-screen";

const navigation = vi.hoisted(() => ({ replace: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn<() => void>() }),
}));

vi.mock("@/shared/api/generated", async (original) => ({
  ...(await original<typeof import("@/shared/api/generated")>()),
  signIn: vi.fn<() => unknown>(),
  signOut: vi.fn<() => unknown>(async () => ({ response: new Response(null, { status: 204 }) })),
}));

// O banco local de verdade precisa do IndexedDB: aqui importa contar as pendências do anterior e apagar (ou não).
vi.mock("@/features/local-store/services/local-store", () => ({
  pendingOf: vi.fn<(ownerId: string) => Promise<number>>(async () => 0),
  wipeLocalStore: vi.fn<(ownerId: string) => Promise<void>>(async () => {}),
}));

// A outbox real precisa do IndexedDB; aqui a tela só a abre.
vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => {} }));

const owner = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Ana Souza" };

const problem = (type: string, status: number) => ({
  error: {
    type: `urn:vistoria:problem:${type}`,
    title: type,
    status,
    detail: type,
    traceId: "00-trace",
  },
  response: new Response(null, { status }),
});

async function fillAndSubmit(email = "ana@exemplo.com", password = "senha-longa") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("E-mail"), email);
  await user.type(screen.getByLabelText("Senha"), password);
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}

afterEach(() => {
  window.history.pushState(null, "", "/");
  resetSession();
  resetSyncStatus();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.mocked(signIn).mockReset();
  vi.mocked(signOut).mockClear();
  vi.mocked(pendingOf).mockReset().mockResolvedValue(0);
  vi.mocked(wipeLocalStore).mockClear();
  navigation.replace.mockReset();
});

describe("/login", () => {
  it("o formulário do Figma: lockup, título, campos e o link para criar conta", () => {
    render(<SignInScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "Entrar" })).toBeDefined();
    expect(screen.getByText("Use o e-mail e a senha da sua conta.")).toBeDefined();
    expect(screen.getByLabelText("E-mail").getAttribute("placeholder")).toBe("voce@exemplo.com");
    expect(screen.getByRole("link", { name: "Criar conta" }).getAttribute("href")).toBe("/signup");
  });

  it("valida antes de enviar", async () => {
    render(<SignInScreen />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Informe o e-mail.")).toBeDefined();
    expect(screen.getByText("Informe a senha.")).toBeDefined();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("e-mail ou senha errados: mensagem no formulário, sem sair da tela", async () => {
    vi.mocked(signIn).mockResolvedValue(problem("invalid-credentials", 401) as never);
    render(<SignInScreen />);

    await fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toBe("E-mail ou senha incorretos.");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("rate-limited: pede para esperar", async () => {
    vi.mocked(signIn).mockResolvedValue(problem("rate-limited", 429) as never);
    render(<SignInScreen />);

    await fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Muitas tentativas. Tente novamente em alguns minutos.",
    );
  });

  it("enquanto envia, o botão diz Entrando… e fica desabilitado; depois leva ao shell", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(signIn).mockReturnValue(new Promise((done) => (answer = done)) as never);
    render(<SignInScreen />);

    await fillAndSubmit();

    const button = await screen.findByRole("button", { name: "Entrando…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      answer({ data: { accessToken: "token", expiresAt: "2026-10-22T15:00:00Z", user: owner } });
    });
    expect(navigation.replace).toHaveBeenCalledWith("/inspections");
    expect(accessToken.get()).toBe("token");
  });

  it("volta para a tela do ?next= depois de entrar", async () => {
    window.history.pushState(null, "", "/login?next=%2Fclients");
    vi.mocked(signIn).mockResolvedValue({
      data: { accessToken: "token", expiresAt: "2026-10-22T15:00:00Z", user: owner },
    } as never);
    render(<SignInScreen />);

    await fillAndSubmit();

    await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/clients"));
  });

  it("sessão expirada com pendências: SessionExpired acima do formulário", async () => {
    localStorage.setItem("vistoria.owner", JSON.stringify(owner));
    resetSession();
    const entry = (id: string) => ({
      id,
      mutationFnName: "upsertClient",
      mutations: [{ modified: { id, name: "Maria" } }],
      createdAt: new Date(),
      retryCount: 0,
      nextAttemptAt: 0,
    });
    trackOutbox({
      peekOutbox: async () => [entry("a"), entry("b")],
      getRunningCount: () => 0,
    } as unknown as Outbox);

    render(<SignInScreen />);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Entre novamente para enviar as 2 alterações salvas neste aparelho. Nada foi perdido.",
      ),
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("sessão expirada sem pendências: o aviso espera a leitura da outbox", async () => {
    localStorage.setItem("vistoria.owner", JSON.stringify(owner));
    resetSession();

    render(<SignInScreen />);
    expect(screen.queryByRole("status")).toBeNull();

    trackOutbox({ peekOutbox: async () => [], getRunningCount: () => 0 } as unknown as Outbox);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Entre novamente para continuar."),
    );
  });

  it("primeiro acesso sem rede: pede conexão", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    render(<SignInScreen />);

    expect(screen.getByRole("status").textContent).toBe(
      "Conexão necessária para o primeiro acesso.",
    );
  });

  it("quem já está com a sessão ativa vai direto para o app", () => {
    localStorage.setItem("vistoria.owner", JSON.stringify(owner));
    resetSession();
    accessToken.set("token");

    render(<SignInScreen />);

    expect(navigation.replace).toHaveBeenCalledWith("/inspections");
  });
  describe("outro usuário (frame 2 da #128)", () => {
    const bia = { id: "0199a0b2-7c1e-7f3a-9b2d-ffffffffffff", name: "Bia Lima" };
    const signedInAs = (who: typeof owner) =>
      ({
        data: { accessToken: "token-novo", expiresAt: "2026-10-31T15:00:00Z", user: who },
      }) as never;

    /** Ana é a dona, com a sessão expirada; Bia entra. */
    function previousOwnerWith(pending: number) {
      localStorage.setItem("vistoria.owner", JSON.stringify(owner));
      resetSession();
      vi.mocked(pendingOf).mockResolvedValue(pending);
      vi.mocked(signIn).mockResolvedValue(signedInAs(bia));
    }

    it("com pendências da anterior: o aviso diz quantas, os campos param, e nada vira sessão", async () => {
      previousOwnerWith(4);
      render(<SignInScreen />);

      await fillAndSubmit("bia@exemplo.com");

      const notice = await screen.findByText("As alterações da outra conta serão apagadas");
      expect(notice.closest("[role=alert]")?.textContent).toContain(
        "Há 4 alterações de Ana Souza que ainda não foram enviadas.",
      );
      // O fieldset desabilita os campos (`:disabled`), sem mexer no atributo de cada um.
      expect(screen.getByLabelText("E-mail").matches(":disabled")).toBe(true);
      expect(screen.getByLabelText("Senha").matches(":disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "Entrar" }).matches(":disabled")).toBe(true);
      expect(accessToken.get()).toBeNull();
      expect(wipeLocalStore).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it("Apagar e entrar: apaga o banco da anterior e entra", async () => {
      previousOwnerWith(4);
      render(<SignInScreen />);
      await fillAndSubmit("bia@exemplo.com");

      await userEvent.setup().click(await screen.findByRole("button", { name: "Apagar e entrar" }));

      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inspections"));
      expect(wipeLocalStore).toHaveBeenCalledExactlyOnceWith(owner.id);
      expect(accessToken.get()).toBe("token-novo");
      expect(JSON.parse(localStorage.getItem("vistoria.owner")!)).toEqual(bia);
    });

    it("Cancelar: signOut da conta nova, o formulário volta e nada muda", async () => {
      previousOwnerWith(4);
      render(<SignInScreen />);
      await fillAndSubmit("bia@exemplo.com");

      await userEvent.setup().click(await screen.findByRole("button", { name: "Cancelar" }));

      await waitFor(() =>
        expect(screen.queryByText("As alterações da outra conta serão apagadas")).toBeNull(),
      );
      expect(signOut).toHaveBeenCalledOnce();
      expect(wipeLocalStore).not.toHaveBeenCalled();
      expect(accessToken.get()).toBeNull();
      expect(JSON.parse(localStorage.getItem("vistoria.owner")!)).toEqual(owner);
      expect(screen.getByLabelText("E-mail").matches(":disabled")).toBe(false);
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it("sem pendências da anterior: entra direto, apagando o banco dela", async () => {
      previousOwnerWith(0);
      render(<SignInScreen />);

      await fillAndSubmit("bia@exemplo.com");

      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inspections"));
      expect(screen.queryByText("As alterações da outra conta serão apagadas")).toBeNull();
      expect(wipeLocalStore).toHaveBeenCalledExactlyOnceWith(owner.id);
    });

    it("a mesma dona entrando de novo: sem aviso, sem apagar, e a fila retoma", async () => {
      previousOwnerWith(4);
      vi.mocked(signIn).mockResolvedValue(signedInAs(owner));
      render(<SignInScreen />);

      await fillAndSubmit();

      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inspections"));
      expect(pendingOf).not.toHaveBeenCalled();
      expect(wipeLocalStore).not.toHaveBeenCalled();
      expect(canSendAs(owner.id)).toBe(true);
    });
  });
});
