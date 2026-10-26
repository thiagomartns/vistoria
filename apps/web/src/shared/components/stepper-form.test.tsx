import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StepperForm, type StepperStep } from "./stepper-form";

// Figma StepperForm 27:1220 e StepperForm/Etapa 26:1145.

const STEPS: StepperStep[] = [
  { id: "r1", label: "Sala", state: "completa", meta: "9 de 9" },
  { id: "r2", label: "Cozinha", state: "pendente", meta: "3 de 8" },
  { id: "r3", label: "Banheiro", state: "erro", meta: "2 erros" },
];

function open(current: number, onStepChange = vi.fn<(index: number) => void>()) {
  render(
    <StepperForm
      title="Ambientes"
      summary="1 de 3 concluídos"
      steps={STEPS}
      current={current}
      onStepChange={onStepChange}
      position={`${STEPS[current]?.label} · ${current + 1} de 3`}
    >
      <p>conteúdo</p>
    </StepperForm>,
  );
  return onStepChange;
}

const nav = () => screen.getByRole("navigation", { name: "Ambientes" });

describe("StepperForm", () => {
  it("etapas com ícone e meta; a atual com aria-current; o resumo e a posição", () => {
    open(1);

    const current = within(nav()).getByRole("button", { name: /Cozinha/ });
    expect(current.getAttribute("aria-current")).toBe("step");
    expect(
      within(nav()).getByRole("button", { name: /Sala/ }).getAttribute("aria-current"),
    ).toBeNull();
    expect(within(nav()).getByText("2 erros")).toBeDefined();
    expect(within(nav()).getByRole("button", { name: /Banheiro/ }).dataset.state).toBe("erro");
    expect(screen.getByText("1 de 3 concluídos")).toBeDefined();
    expect(screen.getByText("Cozinha · 2 de 3")).toBeDefined();
    expect(screen.getByText("conteúdo")).toBeDefined();
  });

  it("Anterior, Próximo e o toque numa etapa trocam de etapa", async () => {
    const user = userEvent.setup();
    const onStepChange = open(1);

    await user.click(screen.getByRole("button", { name: "Próximo" }));
    await user.click(screen.getByRole("button", { name: "Anterior" }));
    await user.click(within(nav()).getByRole("button", { name: /Sala/ }));

    expect(onStepChange.mock.calls).toEqual([[2], [0], [0]]);
  });

  it("nas pontas, Anterior ou Próximo ficam desabilitados", () => {
    open(0);
    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("na última etapa, Próximo fica desabilitado", () => {
    open(2);
    expect((screen.getByRole("button", { name: "Próximo" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("Alt+← e Alt+→ trocam de etapa", () => {
    const onStepChange = open(1);

    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft" });

    expect(onStepChange.mock.calls).toEqual([[2], [0]]);
  });
});
