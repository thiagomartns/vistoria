import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldSyncIndicator, type FieldSyncState } from "./field-sync-indicator";

// Os cinco estados do frame (Figma FieldSyncIndicator 25:1083): ícone decorativo + texto.
const STATES: [FieldSyncState, string][] = [
  ["local", "Não enviado"],
  ["enviando", "Enviando"],
  ["sincronizado", "Salvo"],
  ["conflito", "Em conflito"],
  ["rejeitado", "Revisar"],
];

describe("FieldSyncIndicator", () => {
  it.each(STATES)("%s: %s", (state, label) => {
    const { container } = render(<FieldSyncIndicator state={state} />);

    expect(screen.getByText(label).dataset.state).toBe(state);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
