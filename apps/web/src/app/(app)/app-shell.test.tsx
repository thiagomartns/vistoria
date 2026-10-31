import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "@/shared/api/client";
import { refreshToken } from "@/shared/api/generated";
import { resetSession } from "@/shared/auth/session";
import { resetSyncStatus } from "@/shared/sync/sync-status";
import type { OutboxItemView } from "@/shared/sync/sync-view";

import { AppShell } from "./app-shell";
import { PageHeader } from "./shell-header";

const navigation = vi.hoisted(() => ({
  pathname: "/clients/edit",
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));

vi.mock("@/shared/api/generated", async (original) => ({
  ...(await original<typeof import("@/shared/api/generated")>()),
  refreshToken: vi.fn<() => unknown>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));

// A outbox real precisa do IndexedDB; aqui o shell só a abre, e os rascunhos em conflito vêm daqui.
const outbox = vi.hoisted(() => ({ conflicts: [] as OutboxItemView[] }));
vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({
  useLocalOutbox: () => outbox.conflicts,
}));

const owner = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Ana Souza" };

/** Como depois de um reload: o dono no localStorage e, se `token`, uma sessão ativa. */
function seedSession({ token }: { token: boolean }) {
  localStorage.setItem("vistoria.owner", JSON.stringify(owner));
  resetSession();
  if (token) accessToken.set("token");
}

/** Um JWT só com o `sub`: a sessão confere de quem é o token que o refresh trouxe. */
const tokenOf = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

const refreshed = () =>
  ({
    data: { accessToken: tokenOf(owner.id), expiresAt: "2026-10-31T15:00:00Z" },
  }) as never;

const refreshRefused = () =>
  ({
    error: {
      type: "urn:vistoria:problem:unauthorized",
      title: "Não autenticado",
      status: 401,
      detail: "Refresh token recusado.",
      traceId: "00-trace",
    },
    response: new Response(null, { status: 401 }),
  }) as never;

function setNetwork(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

afterEach(() => {
  resetSyncStatus();
  resetSession();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.mocked(refreshToken).mockReset();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  outbox.conflicts = [];
});

describe("AppShell", () => {
  it("título da rota no header, item ativo nas duas navegações e o conteúdo", () => {
    render(<AppShell>conteúdo da tela</AppShell>);

    expect(screen.getByRole("heading", { level: 1, name: "Clientes" })).toBeDefined();
    for (const nav of screen.getAllByRole("navigation", { name: "Principal" })) {
      expect(within(nav).getByRole("link", { name: "Clientes" }).getAttribute("aria-current")).toBe(
        "page",
      );
    }
    expect(screen.getByRole("main").textContent).toContain("conteúdo da tela");
  });

  it("uma tela de registro troca o título, ganha Voltar e o SyncBadge; ao sair, o header volta", () => {
    const { rerender } = render(
      <AppShell>
        <PageHeader title="Maria Souza" backHref="/clients" sync="local" />
      </AppShell>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Maria Souza" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar" }).getAttribute("href")).toBe("/clients");
    expect(screen.getByText("Salvo no aparelho")).toBeDefined();

    rerender(<AppShell>outra tela</AppShell>);

    expect(screen.getByRole("heading", { level: 1, name: "Clientes" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Voltar" })).toBeNull();
    expect(screen.queryByText("Salvo no aparelho")).toBeNull();
  });

  it("as ações do registro vão para o header, uma vez só, antes do SyncStatus", () => {
    render(
      <AppShell>
        <PageHeader title="Vistoria" actions={<button type="button">Mais ações</button>} focus />
      </AppShell>,
    );

    const header = screen.getByRole("banner");
    const [actions] = within(header).getAllByRole("button", { name: "Mais ações" });
    expect(within(header).getAllByRole("button", { name: "Mais ações" })).toHaveLength(1);
    const [status] = within(header).getAllByRole("button", { name: /^Pendências/ });
    expect(
      actions!.compareDocumentPosition(status!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("reflete a rede: offline mostra o banner e o SyncStatus offline; online, some", () => {
    render(<AppShell>conteúdo</AppShell>);
    expect(screen.queryByText("Você está offline")).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Você está offline")).toBeDefined();
    expect(screen.getAllByRole("button", { name: /^Pendências: Offline/ })).toHaveLength(2);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("Você está offline")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Pendências: Sincronizado/ })).toHaveLength(2);
  });

  it("o SyncStatus abre o painel de pendências", async () => {
    render(<AppShell>conteúdo</AppShell>);

    await userEvent
      .setup()
      .click(screen.getAllByRole("button", { name: /^Pendências/ })[0] as HTMLElement);

    expect(screen.getByRole("dialog", { name: "Pendências" }).textContent).toContain(
      "Tudo sincronizado. Último sync: nenhum ainda.",
    );
  });

  it("conflito: 'Requer ação · 1', o item em 'Ação necessária', e 'Resolver' abre o resolver da vistoria", async () => {
    const user = userEvent.setup();
    outbox.conflicts = [
      {
        id: "conflict:i1",
        state: "conflito",
        title: "Vistoria · 3 ambientes",
        detail: "Alterada também em outro aparelho",
        href: "/inspections/conflict?id=i1",
      },
    ];
    render(<AppShell>conteúdo</AppShell>);

    const [status] = screen.getAllByRole("button", { name: /^Pendências/ });
    expect(status?.textContent).toContain("Requer ação");
    await user.click(status as HTMLElement);
    const actions = within(screen.getByRole("dialog", { name: "Pendências" })).getByRole("region", {
      name: "Ação necessária",
    });
    expect(within(actions).getByText("Vistoria · 3 ambientes")).toBeDefined();
    await user.click(within(actions).getByRole("button", { name: "Resolver" }));

    expect(navigation.push).toHaveBeenCalledWith("/inspections/conflict?id=i1");
    expect(screen.queryByRole("dialog", { name: "Pendências" })).toBeNull();
  });

  it("sem sessão, Entrar leva ao login", async () => {
    const user = userEvent.setup();
    render(<AppShell>conteúdo</AppShell>);

    await user.click(screen.getAllByRole("button", { name: "Menu do usuário" })[0] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "Entrar" }));

    expect(navigation.push).toHaveBeenCalledWith("/login");
  });

  describe("guarda da sessão", () => {
    it("sem ninguém no aparelho, vai para /login, com a volta para a tela atual", () => {
      window.history.pushState(null, "", "/clients/edit?id=c1");
      render(<AppShell>conteúdo</AppShell>);

      expect(navigation.replace).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/clients/edit?id=c1")}`,
      );
    });

    it("sessão ativa fica, com o nome do dono no menu", () => {
      seedSession({ token: true });
      render(<AppShell>conteúdo</AppShell>);

      expect(navigation.replace).not.toHaveBeenCalled();
      expect(screen.getByText("Ana Souza")).toBeDefined();
    });

    it("recarregou offline com a sessão expirada: fica, com o OfflineBanner", () => {
      seedSession({ token: false });
      setNetwork(false);
      render(<AppShell>dados locais</AppShell>);

      expect(navigation.replace).not.toHaveBeenCalled();
      expect(screen.getByText("Você está offline")).toBeDefined();
      expect(screen.getByRole("main").textContent).toContain("dados locais");
    });

    it("recarregou com rede e cookie válido: renova e fica, sem /login", async () => {
      vi.mocked(refreshToken).mockResolvedValue(refreshed());
      seedSession({ token: false });
      setNetwork(true);
      render(<AppShell>dados locais</AppShell>);

      await act(async () => {});

      expect(refreshToken).toHaveBeenCalledTimes(1);
      expect(accessToken.get()).toBe(tokenOf(owner.id));
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it("recarregou com rede e o refresh recusado: vai para /login", async () => {
      vi.mocked(refreshToken).mockResolvedValue(refreshRefused());
      seedSession({ token: false });
      setNetwork(true);
      render(<AppShell>dados locais</AppShell>);

      expect(navigation.replace).not.toHaveBeenCalled();
      await act(async () => {});

      expect(navigation.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
    });

    it("a rede volta com a sessão expirada: renova; recusado, vai para /login", async () => {
      vi.mocked(refreshToken).mockResolvedValue(refreshRefused());
      seedSession({ token: false });
      setNetwork(false);
      render(<AppShell>dados locais</AppShell>);
      expect(refreshToken).not.toHaveBeenCalled();

      setNetwork(true);
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });

      expect(refreshToken).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
    });

    it("a rede volta com a sessão expirada e o cookie válido: renova e fica", async () => {
      vi.mocked(refreshToken).mockResolvedValue(refreshed());
      seedSession({ token: false });
      setNetwork(false);
      render(<AppShell>dados locais</AppShell>);

      setNetwork(true);
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });

      expect(accessToken.get()).toBe(tokenOf(owner.id));
      expect(navigation.replace).not.toHaveBeenCalled();
    });
  });
});
