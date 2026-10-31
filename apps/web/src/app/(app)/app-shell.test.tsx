import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { accessToken } from "@/shared/api/client";
import { refreshToken } from "@/shared/api/generated";
import { pendingOf } from "@/features/local-store/services/local-store";
import { signOutOnDevice } from "@/features/local-store/services/device-session";
import { OFFLINE_WINDOW_MS } from "@/shared/auth/offline-window";
import { resetSession } from "@/shared/auth/session";
import { clock } from "@/shared/clock";
import { reloadAt } from "@/shared/navigation";
import type { Outbox } from "@/shared/sync/outbox";
import { resetSyncStatus, trackOutbox } from "@/shared/sync/sync-status";
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

// O banco local e o "Sair" de verdade estão nos testes do device-session e do local-store; aqui, o que o shell decide.
vi.mock("@/features/local-store/services/local-store", () => ({
  pendingOf: vi.fn<(ownerId: string) => Promise<number>>(async () => 0),
  wipeLocalStore: vi.fn<(ownerId: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/features/local-store/services/device-session", () => ({
  signOutOnDevice: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock("@/shared/navigation", () => ({ reloadAt: vi.fn<(href: string) => void>() }));

const owner = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Ana Souza" };

/** O relógio dos testes: a última renovação aceita foi há pouco, dentro da janela offline. */
const RENEWED_AT = new Date("2026-10-28T12:00:00Z");
const realNow = clock.now;

/**
 * Como depois de um reload: o dono no localStorage, a data da última renovação aceita e, se `token`, uma sessão
 * ativa. O relógio fica `elapsed` depois dessa renovação (1 min por padrão).
 */
function seedSession({ token, elapsed = 60 * 1000 }: { token: boolean; elapsed?: number }) {
  localStorage.setItem("vistoria.owner", JSON.stringify(owner));
  localStorage.setItem("vistoria.renewed-at", RENEWED_AT.toISOString());
  clock.now = () => new Date(RENEWED_AT.getTime() + elapsed);
  resetSession();
  if (token) accessToken.set("token");
}

/** Uma outbox com `count` transações, para o SyncStatus e o bloqueio dizerem quantas há. */
function seedOutbox(count: number) {
  const entries = Array.from({ length: count }, (_, i) => ({
    id: `tx-${i}`,
    mutationFnName: "upsertClient",
    mutations: [{ modified: { id: `c${i}`, name: `Cliente ${i}` } }],
    createdAt: new Date(RENEWED_AT),
    retryCount: 0,
    nextAttemptAt: 0,
  }));
  trackOutbox({
    peekOutbox: async () => entries,
    getRunningCount: () => 0,
  } as unknown as Outbox);
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
  clock.now = realNow;
  vi.mocked(pendingOf).mockReset().mockResolvedValue(0);
  vi.mocked(signOutOnDevice).mockClear();
  vi.mocked(reloadAt).mockClear();
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
  describe("janela offline de 72 h", () => {
    const BLOCK = "Reconecte para continuar";

    it("72 h + 1 min depois do último refresh aceito: bloqueia, sem apagar nada", async () => {
      seedSession({ token: false, elapsed: OFFLINE_WINDOW_MS + 60 * 1000 });
      seedOutbox(12);
      setNetwork(false);
      render(<AppShell>dados locais</AppShell>);
      await act(async () => {});

      expect(screen.getByRole("heading", { name: BLOCK })).toBeDefined();
      expect(screen.getByRole("alert").textContent).toContain(
        "Nada foi apagado: as 12 alterações pendentes continuam salvas aqui.",
      );
      expect(screen.getByRole("main").textContent).not.toContain("dados locais");
      expect(signOutOnDevice).not.toHaveBeenCalled();
      expect(localStorage.getItem("vistoria.owner")).not.toBeNull();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it("72 h exatas ainda não bloqueiam", () => {
      seedSession({ token: false, elapsed: OFFLINE_WINDOW_MS });
      setNetwork(false);
      render(<AppShell>dados locais</AppShell>);

      expect(screen.queryByRole("heading", { name: BLOCK })).toBeNull();
      expect(screen.getByRole("main").textContent).toContain("dados locais");
    });

    it("com o app aberto, o bloqueio chega quando o prazo vence", () => {
      vi.useFakeTimers();
      try {
        seedSession({ token: true, elapsed: OFFLINE_WINDOW_MS - 30 * 1000 });
        render(<AppShell>dados locais</AppShell>);
        expect(screen.queryByRole("heading", { name: BLOCK })).toBeNull();

        clock.now = () => new Date(RENEWED_AT.getTime() + OFFLINE_WINDOW_MS + 30 * 1000);
        act(() => {
          vi.advanceTimersByTime(60 * 1000);
        });

        expect(screen.getByRole("heading", { name: BLOCK })).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("Tentar novamente com a rede de volta: o refresh aceito tira o bloqueio", async () => {
      vi.mocked(refreshToken).mockResolvedValue(refreshed());
      seedSession({ token: false, elapsed: OFFLINE_WINDOW_MS + 60 * 1000 });
      setNetwork(false);
      render(<AppShell>dados locais</AppShell>);
      expect(screen.getByRole("heading", { name: BLOCK })).toBeDefined();

      setNetwork(true);
      clock.now = realNow;
      await userEvent.setup().click(screen.getByRole("button", { name: "Tentar novamente" }));
      await act(async () => {});

      expect(refreshToken).toHaveBeenCalledOnce();
      expect(screen.queryByRole("heading", { name: BLOCK })).toBeNull();
      expect(screen.getByRole("main").textContent).toContain("dados locais");
    });

    it("Tentar novamente sem rede: continua bloqueado", async () => {
      vi.mocked(refreshToken).mockRejectedValue(new TypeError("Failed to fetch"));
      seedSession({ token: false, elapsed: OFFLINE_WINDOW_MS + 60 * 1000 });
      setNetwork(false);
      render(<AppShell>dados locais</AppShell>);

      await userEvent.setup().click(screen.getByRole("button", { name: "Tentar novamente" }));
      await act(async () => {});

      expect(screen.getByRole("heading", { name: BLOCK })).toBeDefined();
    });
  });

  describe("Sair", () => {
    async function signOut() {
      const user = userEvent.setup();
      await user.click(
        screen.getAllByRole("button", { name: "Menu do usuário" })[0] as HTMLElement,
      );
      await user.click(screen.getByRole("menuitem", { name: "Sair" }));
      await act(async () => {});
      return user;
    }

    it("sem pendências: sai e limpa direto, sem Dialog, e recarrega no /login", async () => {
      seedSession({ token: true });
      render(<AppShell>conteúdo</AppShell>);

      await signOut();

      expect(pendingOf).toHaveBeenCalledExactlyOnceWith(owner.id);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(signOutOnDevice).toHaveBeenCalledOnce();
      expect(reloadAt).toHaveBeenCalledExactlyOnceWith("/login");
    });

    it("com pendências: o Dialog diz quantas, e só limpa depois de confirmar", async () => {
      vi.mocked(pendingOf).mockResolvedValue(3);
      seedSession({ token: true });
      render(<AppShell>conteúdo</AppShell>);

      const user = await signOut();

      const dialog = screen.getByRole("dialog", {
        name: "Sair e apagar as alterações deste aparelho?",
      });
      expect(dialog.textContent).toContain("Há 3 alterações que ainda não foram enviadas.");
      expect(dialog.textContent).not.toContain("Sem rede");
      expect(signOutOnDevice).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Sair e apagar" }));
      await act(async () => {});

      expect(signOutOnDevice).toHaveBeenCalledOnce();
      expect(reloadAt).toHaveBeenCalledExactlyOnceWith("/login");
    });

    it("com pendências, Cancelar fecha e não limpa nada", async () => {
      vi.mocked(pendingOf).mockResolvedValue(3);
      seedSession({ token: true });
      render(<AppShell>conteúdo</AppShell>);

      const user = await signOut();
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(signOutOnDevice).not.toHaveBeenCalled();
      expect(reloadAt).not.toHaveBeenCalled();
    });

    it("com pendências e offline: o Dialog tem a frase a mais", async () => {
      vi.mocked(pendingOf).mockResolvedValue(3);
      seedSession({ token: true });
      setNetwork(false);
      render(<AppShell>conteúdo</AppShell>);

      await signOut();

      expect(screen.getByRole("dialog").textContent).toContain(
        "Sem rede, elas não têm como ser enviadas agora: conecte-se e espere o envio para não perder nada.",
      );
    });
  });
});
