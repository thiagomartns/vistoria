import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "./app-shell";

const navigation = vi.hoisted(() => ({ pathname: "/clients/edit", push: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, replace: vi.fn<() => void>() }),
}));

// A outbox real precisa do IndexedDB; aqui o shell só a abre.
vi.mock("@/features/clients/hooks/useClientsOutbox", () => ({ useClientsOutbox: () => {} }));

afterEach(() => {
  resetSyncStatus();
  navigation.push.mockReset();
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

  it("sem sessão, Entrar leva ao login", async () => {
    const user = userEvent.setup();
    render(<AppShell>conteúdo</AppShell>);

    await user.click(screen.getAllByRole("button", { name: "Menu do usuário" })[0] as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "Entrar" }));

    expect(navigation.push).toHaveBeenCalledWith("/login");
  });
});
