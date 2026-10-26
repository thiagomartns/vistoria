import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InspectionItem } from "./inspection-item";

// Figma InspectionItem 42:1758: observação sob demanda, indicador de sync e somente leitura.

function open(props: { hasNotes?: boolean; readOnly?: boolean; sync?: "local" | "enviando" } = {}) {
  render(
    <InspectionItem
      name="Piso"
      condition={<div role="radiogroup" aria-label="Condição: Piso" />}
      notes={<textarea aria-label="Observação: Piso" />}
      hasNotes={props.hasNotes ?? false}
      readOnly={props.readOnly}
      sync={props.sync}
    />,
  );
}

describe("InspectionItem", () => {
  it("sem observação, o botão a abre e dá o foco ao campo", async () => {
    const user = userEvent.setup();
    open();

    expect(screen.queryByLabelText("Observação: Piso")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Adicionar observação: Piso" }));

    expect(document.activeElement).toBe(screen.getByLabelText("Observação: Piso"));
    expect(screen.queryByRole("button", { name: /Adicionar observação/ })).toBeNull();
  });

  it("com observação, o campo já vem aberto", () => {
    open({ hasNotes: true });

    expect(screen.getByLabelText("Observação: Piso")).toBeDefined();
  });

  it("somente leitura esconde o botão; o indicador de sync aparece ao lado do nome", () => {
    open({ readOnly: true, sync: "enviando" });

    expect(screen.queryByRole("button", { name: /Adicionar observação/ })).toBeNull();
    expect(screen.getByText("Enviando")).toBeDefined();
  });

  it("sem estado de sync, nada (silêncio no caminho feliz)", () => {
    open();

    expect(screen.queryByText("Não enviado")).toBeNull();
  });
});
