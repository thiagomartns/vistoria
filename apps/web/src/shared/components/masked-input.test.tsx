import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { fillPattern } from "@/shared/mask";

import { MaskedInput, caretAfter, significantCount } from "./masked-input";

// Uma máscara de telefone (00) 0000-0000, só para o teste: as de verdade ficam nos schemas das features.
const phone = (raw: string) => fillPattern(raw.replace(/\D/g, "").slice(0, 10), "(00) 0000-0000");

function Field({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MaskedInput aria-label="Telefone" mask={phone} value={value} onChange={setValue} />;
}

const input = () => screen.getByLabelText("Telefone") as HTMLInputElement;

describe("caretAfter e significantCount", () => {
  it("contam só letras e dígitos", () => {
    expect(significantCount("(71) 3")).toBe(3);
    expect(caretAfter("(71) 3333-0000", 3)).toBe(6);
    expect(caretAfter("(71) 3333-0000", 2)).toBe(3);
    expect(caretAfter("(71) 3333-0000", 0)).toBe(0);
    expect(caretAfter("(71", 5)).toBe(3);
  });
});

describe("MaskedInput", () => {
  it("mascara ao digitar, com o cursor no fim", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.type(input(), "7133330000");

    expect(input().value).toBe("(71) 3333-0000");
    expect(input().selectionStart).toBe(14);
  });

  it("digitar no meio mantém o cursor depois do que entrou, mesmo com o separador mudando de lugar", async () => {
    const user = userEvent.setup();
    render(<Field initial="(71) 3330-000" />);

    // Entre o "333" e o "0": o 4º dígito do número empurra o hífen.
    await user.click(input());
    input().setSelectionRange(8, 8);
    await user.keyboard("3");

    expect(input().value).toBe("(71) 3333-0000");
    expect(input().selectionStart).toBe(9);
  });

  it("apagar no meio mantém o cursor no lugar", async () => {
    const user = userEvent.setup();
    render(<Field initial="(71) 3333-0000" />);

    await user.click(input());
    input().setSelectionRange(9, 9);
    await user.keyboard("{Backspace}");

    expect(input().value).toBe("(71) 3330-000");
    expect(input().selectionStart).toBe(8);
  });

  it("uma letra não entra e não move o cursor", async () => {
    const user = userEvent.setup();
    render(<Field initial="(71) 3333" />);

    await user.click(input());
    input().setSelectionRange(3, 3);
    await user.keyboard("a");

    expect(input().value).toBe("(71) 3333");
    expect(input().selectionStart).toBe(3);
  });

  it("colar no meio põe o cursor depois do que entrou", async () => {
    const user = userEvent.setup();
    render(<Field initial="(71) 0000" />);

    await user.click(input());
    input().setSelectionRange(5, 5);
    await user.paste("3.333");

    expect(input().value).toBe("(71) 3333-0000");
    expect(input().selectionStart).toBe(9);
  });

  it("colar com outra máscara dá o mesmo que digitar", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.click(input());
    await user.paste("71.3333.0000");

    expect(input().value).toBe("(71) 3333-0000");
  });
});
