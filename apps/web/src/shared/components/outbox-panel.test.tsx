import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OutboxItemView } from "@/shared/sync/sync-view";

import { OutboxPanel, OutboxPanelItem } from "./outbox-panel";

const item = (
  state: OutboxItemView["state"],
  title: string,
  detail = "detalhe",
): OutboxItemView => ({
  id: title,
  state,
  title,
  detail,
});

function renderPanel(over: Partial<Parameters<typeof OutboxPanel>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn<(open: boolean) => void>(),
    description: "5 alterações ainda não chegaram ao servidor. Último sync: hoje, 14:30.",
    actionNeeded: [item("conflito", "Vistoria · Apto 51"), item("rejeitada", "Vistoria · Loja 3")],
    failing: [item("travada", "Imóvel · Sala 1104")],
    waiting: [item("enviando", "Vistoria · Casa 12"), item("pendente", "Vistoria · Apto 302")],
    onRetryNow: vi.fn<() => void>(),
    ...over,
  };
  render(<OutboxPanel {...props} />);
  return props;
}

describe("OutboxPanel", () => {
  it("abre como diálogo com título, descrição e os três grupos na ordem do frame", () => {
    renderPanel();

    const dialog = screen.getByRole("dialog", { name: "Pendências" });
    expect(within(dialog).getByText(/5 alterações ainda não chegaram/)).toBeDefined();
    const groups = within(dialog).getAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Ação necessária",
      "Falha no envio",
      "Aguardando envio",
    ]);
    expect(within(groups[2] as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
  });

  it("grupo vazio não aparece", () => {
    renderPanel({ actionNeeded: [], failing: [] });

    expect(screen.getAllByRole("region").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Aguardando envio",
    ]);
  });

  it("vazio: só a descrição, sem Tentar agora", () => {
    renderPanel({ description: "Tudo sincronizado.", actionNeeded: [], failing: [], waiting: [] });

    expect(screen.queryAllByRole("region")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Tentar agora" })).toBeNull();
  });

  it("Tentar agora acorda a fila", async () => {
    const props = renderPanel();

    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar agora" }));

    expect(props.onRetryNow).toHaveBeenCalledOnce();
  });

  it("fechar devolve o controle a quem abriu", async () => {
    const props = renderPanel();

    await userEvent.setup().click(screen.getByRole("button", { name: "Fechar" }));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("OutboxPanelItem", () => {
  const renderItem = (node: React.ReactNode) => render(<ul>{node}</ul>);

  it.each([
    ["pendente", "text-muted-foreground"],
    ["enviando", "text-brand-text"],
    ["travada", "text-warning-text"],
    ["conflito", "text-danger-text"],
    ["rejeitada", "text-danger-text"],
  ] as const)("%s: ícone com a cor do estado, título e detalhe", (state, iconColor) => {
    const { container } = renderItem(
      <OutboxPanelItem {...item(state, "Cliente · Maria", "Enviando…")} />,
    );

    const row = screen.getByRole("listitem");
    expect(row.dataset.state).toBe(state);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain(iconColor);
    expect(within(row).getByText("Cliente · Maria")).toBeDefined();
    expect(within(row).getByText("Enviando…")).toBeDefined();
  });

  it("travada: destaque warning com o selo Falha no envio", () => {
    renderItem(<OutboxPanelItem {...item("travada", "Imóvel · Sala 1104")} />);

    expect(screen.getByRole("listitem").className).toContain("bg-warning-subtle");
    expect(screen.getByText("Falha no envio")).toBeDefined();
  });

  it.each([
    ["pendente", "onCancel", "Cancelar"],
    ["conflito", "onResolve", "Resolver"],
    ["rejeitada", "onOpen", "Abrir"],
  ] as const)("%s: o botão %s só aparece com a ação ligada", async (state, handler, label) => {
    const action = vi.fn<() => void>();
    const { rerender } = renderItem(<OutboxPanelItem {...item(state, "x")} />);
    expect(screen.queryByRole("button", { name: label })).toBeNull();

    rerender(
      <ul>
        <OutboxPanelItem {...item(state, "x")} {...{ [handler]: action }} />
      </ul>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: label }));

    expect(action).toHaveBeenCalledOnce();
  });
});
