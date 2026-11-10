import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InspectionItem } from "./inspection-item";

// Figma InspectionItem 42:1758: observação sob demanda, indicador de sync e somente leitura.

function open(
  props: {
    hasNotes?: boolean;
    readOnly?: boolean;
    sync?: "local" | "enviando";
    reference?: { condition: string; notes: string | null };
  } = {},
) {
  render(
    <InspectionItem
      name="Piso"
      condition={<div role="radiogroup" aria-label="Condição: Piso" />}
      notes={<textarea aria-label="Observação: Piso" />}
      hasNotes={props.hasNotes ?? false}
      readOnly={props.readOnly}
      sync={props.sync}
      reference={props.reference}
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

  // Figma 42:1632 (desktop, sob o nome) e 42:1715 (celular, faixa acima dos chips): as duas formas estão no DOM, e o CSS
  // mostra uma por largura.
  it("na saída, o que o item tinha na entrada: a condição e a observação, ou \"Sem observação.\"", () => {
    open({ reference: { condition: "Bom", notes: "Pintura nova." } });

    expect(screen.getAllByText("Na entrada")).toHaveLength(2);
    expect(screen.getAllByText("Bom")).toHaveLength(2);
    expect(screen.getAllByText("Pintura nova.")).toHaveLength(2);
  });

  it("na saída, a entrada sem observação diz \"Sem observação.\"", () => {
    open({ reference: { condition: "Novo", notes: null } });
    expect(screen.getAllByText("Sem observação.")).toHaveLength(2);
  });

  it("sem referência (a entrada, ou o item posto depois na saída), nada da entrada aparece", () => {
    open();
    expect(screen.queryByText("Na entrada")).toBeNull();
  });
});
