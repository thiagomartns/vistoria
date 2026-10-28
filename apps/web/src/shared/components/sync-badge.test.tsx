import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncBadge, type SyncBadgeState } from "./sync-badge";

// Os estados do frame (Figma SyncBadge 25:1053, e "excluindo", 139:1821): sempre ícone + texto.
const STATES: [SyncBadgeState, string][] = [
  ["local", "Salvo no aparelho"],
  ["enviando", "Enviando"],
  ["sincronizado", "Sincronizado"],
  ["conflito", "Conflito"],
  ["rejeitado", "Correção necessária"],
  ["excluindo", "Excluindo"],
];

describe("SyncBadge", () => {
  it.each(STATES)("%s: %s com ícone decorativo", (state, label) => {
    const { container } = render(<SyncBadge state={state} />);

    const badge = screen.getByText(label);
    expect(badge.dataset.state).toBe(state);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("enviando gira o ícone, só sem prefers-reduced-motion", () => {
    const { container } = render(<SyncBadge state="enviando" />);

    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "motion-safe:animate-spin",
    );
  });
});
