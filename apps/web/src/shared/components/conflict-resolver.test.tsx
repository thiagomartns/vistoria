import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  type ConflictChoice,
  ConflictField,
  ConflictResolver,
  type ConflictResolverGroup,
} from "./conflict-resolver";

// O ConflictResolver tipo edição (Figma 32:1787) e o campo (30:1431): só props, como a tela o usa.

const GROUPS: ConflictResolverGroup[] = [
  {
    id: "r2",
    title: "Cozinha",
    fields: [
      {
        key: "piso",
        label: "Piso · Condição",
        before: "Antes: Bom",
        mine: "Regular",
        theirs: "Ruim",
      },
      {
        key: "obs",
        label: "Piso · Observação",
        before: "Antes: sem observação",
        mine: "Rachadura no rodapé, perto da janela.",
        theirs: "Rodapé solto na parede da pia.",
      },
    ],
  },
  {
    id: "r3",
    title: "Banheiro social",
    fields: [
      { key: "box", label: "Box · Condição", before: null, mine: "Regular", theirs: "Ausente" },
    ],
  },
];

function renderResolver(over: Partial<Parameters<typeof ConflictResolver>[0]> = {}) {
  const props = {
    description:
      "Apto 302, R. das Flores · Vistoria de entrada. Ela foi alterada em outro aparelho.",
    mineOrigin: "Neste aparelho · 15:02",
    theirsOrigin: "No servidor · 14:58",
    groups: GROUPS,
    summary: "0 de 3 campos resolvidos",
    remaining: "Faltam 3 campos",
    canSubmit: false,
    onChoose: vi.fn<(key: string, choice: ConflictChoice) => void>(),
    onChooseAll: vi.fn<(choice: ConflictChoice) => void>(),
    onSubmit: vi.fn<() => void>(),
    onBack: vi.fn<() => void>(),
    ...over,
  };
  render(<ConflictResolver {...props} />);
  return props;
}

describe("ConflictField", () => {
  function Controlled({ initial }: { initial?: ConflictChoice }) {
    const [choice, setChoice] = useState(initial);
    return (
      <ConflictField
        label="Piso · Condição"
        before="Antes: Bom"
        mine={{ origin: "Neste aparelho · 15:02", value: "Regular" }}
        theirs={{ origin: "No servidor · 14:58", value: "Ruim" }}
        choice={choice}
        onChoose={setChoice}
      />
    );
  }

  it("nenhuma escolha: dois radios desmarcados, com a origem, a hora e o valor, e o 'Antes'", () => {
    render(<Controlled />);

    const group = screen.getByRole("radiogroup", { name: "Piso · Condição" });
    const [mine, theirs] = within(group).getAllByRole("radio");
    expect(mine?.getAttribute("aria-checked")).toBe("false");
    expect(theirs?.getAttribute("aria-checked")).toBe("false");
    expect(within(group).getByText("Neste aparelho · 15:02")).toBeDefined();
    expect(within(group).getByText("No servidor · 14:58")).toBeDefined();
    expect(screen.getByText("Antes: Bom")).toBeDefined();
  });

  it("clicar no cartão inteiro escolhe; a escolhida fica marcada e destacada", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByText("Ruim"));

    const theirs = screen.getByRole("radio", { name: /No servidor/ });
    expect(theirs.getAttribute("aria-checked")).toBe("true");
    expect(theirs.closest("label")?.dataset.chosen).toBe("true");
    expect(
      screen.getByRole("radio", { name: /Neste aparelho/ }).closest("label")?.dataset.chosen,
    ).toBe("false");
  });

  it("pelo teclado: Tab entra no escolhido, as setas movem o foco e Espaço escolhe", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="meu" />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Neste aparelho/ }));
    await user.keyboard("{ArrowDown}");
    const theirs = screen.getByRole("radio", { name: /No servidor/ });
    expect(document.activeElement).toBe(theirs);
    await user.keyboard(" ");

    expect(theirs.getAttribute("aria-checked")).toBe("true");
  });
});

describe("ConflictResolver", () => {
  it("cabeçalho com o SyncBadge, os campos agrupados por ambiente e o resumo", () => {
    renderResolver();

    expect(screen.getByRole("heading", { name: "Resolver conflito" })).toBeDefined();
    expect(screen.getByText("Conflito")).toBeDefined();
    expect(screen.getByText(/Ela foi alterada em outro aparelho/)).toBeDefined();
    const kitchen = screen.getByRole("region", { name: "Cozinha" });
    expect(
      within(kitchen)
        .getAllByRole("radiogroup")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Piso · Condição", "Piso · Observação"]);
    expect(
      within(screen.getByRole("region", { name: "Banheiro social" })).getByRole("radiogroup", {
        name: "Box · Condição",
      }),
    ).toBeDefined();
    expect(screen.getByText("0 de 3 campos resolvidos")).toBeDefined();
    expect(screen.getByText("Faltam 3 campos")).toBeDefined();
  });

  it("escolher um campo, ou todos de um lado, avisa quem usa", async () => {
    const user = userEvent.setup();
    const props = renderResolver();

    await user.click(screen.getByText("Ausente"));
    await user.click(screen.getByRole("button", { name: "Usar todos os meus" }));
    await user.click(screen.getByRole("button", { name: "Usar todos do servidor" }));

    expect(props.onChoose).toHaveBeenCalledWith("box", "servidor");
    expect(props.onChooseAll).toHaveBeenNthCalledWith(1, "meu");
    expect(props.onChooseAll).toHaveBeenNthCalledWith(2, "servidor");
  });

  it("'Enviar resolução' fica desabilitado até tudo ter escolha; 'Voltar' sempre funciona", async () => {
    const user = userEvent.setup();
    const props = renderResolver();

    expect(screen.getByRole("button", { name: "Enviar resolução" }).hasAttribute("disabled")).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("com tudo escolhido, envia; enquanto envia, não envia de novo", async () => {
    const user = userEvent.setup();
    const props = renderResolver({ canSubmit: true, remaining: "Tudo escolhido" });

    await user.click(screen.getByRole("button", { name: "Enviar resolução" }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("enviando: o botão fica desabilitado", () => {
    renderResolver({ canSubmit: true, submitting: true });

    expect(screen.getByRole("button", { name: "Enviar resolução" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
