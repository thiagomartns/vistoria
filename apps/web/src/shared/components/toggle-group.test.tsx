import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

// Chips de escolha única (Figma ToggleGroup 41:1661): radiogroup, um Tab só, setas movem o foco, Espaço marca.

const VALUES = ["new", "good", "fair"] as const;

function Chips({
  initial = null,
  onChange = () => {},
  ...props
}: {
  initial?: string | null;
  onChange?: (value: string) => void;
  invalid?: boolean;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ToggleGroup
      aria-label="Condição: Piso"
      value={value}
      values={VALUES}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      {...props}
    >
      <ToggleGroupItem value="new">Novo</ToggleGroupItem>
      <ToggleGroupItem value="good">Bom</ToggleGroupItem>
      <ToggleGroupItem value="fair">Regular</ToggleGroupItem>
    </ToggleGroup>
  );
}

const chip = (name: string) => screen.getByRole("radio", { name });

describe("ToggleGroup", () => {
  it("um toque marca; o marcado tem aria-checked e o Check (não só cor)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: string) => void>();
    render(<Chips onChange={onChange} />);

    expect(screen.getByRole("radiogroup", { name: "Condição: Piso" })).toBeDefined();
    await user.click(chip("Bom"));

    expect(onChange).toHaveBeenCalledWith("good");
    expect(chip("Bom").getAttribute("aria-checked")).toBe("true");
    expect(chip("Novo").getAttribute("aria-checked")).toBe("false");
    expect(chip("Bom").querySelector("svg")).not.toBeNull();
  });

  it("teclado: Tab entra no marcado, setas movem o foco sem marcar, Espaço marca", async () => {
    const user = userEvent.setup();
    render(<Chips initial="good" />);

    await user.tab();
    expect(document.activeElement).toBe(chip("Bom"));
    expect(chip("Novo").tabIndex).toBe(-1);

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(chip("Regular"));
    expect(chip("Bom").getAttribute("aria-checked")).toBe("true");

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(chip("Novo"));
    await user.keyboard(" ");
    expect(chip("Novo").getAttribute("aria-checked")).toBe("true");
  });

  it("sem nada marcado, o Tab entra no primeiro", async () => {
    const user = userEvent.setup();
    render(<Chips />);

    await user.tab();

    expect(document.activeElement).toBe(chip("Novo"));
  });

  it("inválido: aria-invalid no grupo e borda destructive nos itens", () => {
    render(<Chips invalid />);

    expect(screen.getByRole("radiogroup").getAttribute("aria-invalid")).toBe("true");
    expect(chip("Bom").className).toContain("border-destructive");
  });

  it("somente leitura (envio em voo): não marca, e o marcado continua à vista", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: string) => void>();
    render(<Chips initial="good" readOnly onChange={onChange} />);

    await user.click(chip("Regular"));

    expect(onChange).not.toHaveBeenCalled();
    expect((chip("Regular") as HTMLButtonElement).disabled).toBe(true);
    expect(chip("Bom").getAttribute("aria-checked")).toBe("true");
    expect(chip("Bom").className).toContain("bg-secondary");
  });

  it("um item desabilitado não marca", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: string) => void>();
    render(
      <ToggleGroup
        aria-label="Tipo"
        value="moveIn"
        values={["moveIn", "moveOut"]}
        onValueChange={onChange}
      >
        <ToggleGroupItem value="moveIn">Entrada</ToggleGroupItem>
        <ToggleGroupItem value="moveOut" disabled>
          Saída
        </ToggleGroupItem>
      </ToggleGroup>,
    );

    await user.click(chip("Saída"));

    expect(onChange).not.toHaveBeenCalled();
    expect((chip("Saída") as HTMLButtonElement).disabled).toBe(true);
  });
});
