import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SyncStatusState } from "@/shared/sync/sync-view";

import { SyncStatus } from "./sync-status";

// Os quatro estados do frame, nos dois tamanhos (Figma SyncStatus 12:1307).
const STATES: [SyncStatusState, string, string, string][] = [
  ["sincronizado", "Sincronizado", "há 2 min", "Sincronizado"],
  ["enviando", "Enviando", "3 alterações", "Enviando 3"],
  ["offline", "Offline", "3 pendentes", "Offline · 3"],
  ["requer-acao", "Requer ação", "2 precisam de você", "Requer ação · 2"],
];

describe("SyncStatus", () => {
  it.each(STATES)("%s completo: ícone, rótulo e detalhe", (state, label, detail) => {
    const { container } = render(
      <SyncStatus state={state} label={label} detail={detail} size="completo" />,
    );

    const button = screen.getByRole("button", { name: `Pendências: ${label}, ${detail}` });
    expect(button.dataset.state).toBe(state);
    expect(button.className).toContain("h-8");
    expect(screen.getByText(label)).toBeDefined();
    expect(screen.getByText(detail)).toBeDefined();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each(STATES)("%s compacto: só o rótulo, alvo de 40 px", (state, _label, detail, compact) => {
    render(<SyncStatus state={state} label={compact} detail={detail} size="compacto" />);

    const button = screen.getByRole("button", { name: `Pendências: ${compact}` });
    expect(button.className).toContain("h-10");
    expect(screen.queryByText(detail)).toBeNull();
  });

  it("silêncio no caminho feliz: só offline e requer ação ganham fundo", () => {
    const backgrounds = STATES.map(([state, label]) => {
      const { unmount } = render(<SyncStatus state={state} label={label} size="completo" />);
      const className = screen.getByRole("button").className;
      unmount();
      return [state, /bg-(warning|danger)-subtle/.exec(className)?.[0] ?? "neutro"];
    });

    expect(Object.fromEntries(backgrounds)).toEqual({
      sincronizado: "neutro",
      enviando: "neutro",
      offline: "bg-warning-subtle",
      "requer-acao": "bg-danger-subtle",
    });
  });

  it("um toque abre as pendências", async () => {
    const onClick = vi.fn<() => void>();
    render(<SyncStatus state="offline" label="Offline" size="compacto" onClick={onClick} />);

    await userEvent.setup().click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
