import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AvisLockup } from "./avis-lockup";

describe("AvisLockup", () => {
  it.each(["horizontal", "vertical"] as const)(
    'no layout %s, o leitor de tela lê "Avis" uma vez',
    (layout) => {
      const { container } = render(<AvisLockup layout={layout} />);

      expect(screen.getByText("Avis")).toBeDefined();
      expect(screen.queryByRole("img")).toBeNull();
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it("mostra a legenda só quando pedida", () => {
    const { rerender } = render(<AvisLockup layout="vertical" />);
    expect(screen.queryByText("Vistoria de imóveis")).toBeNull();

    rerender(<AvisLockup layout="vertical" caption />);
    expect(screen.getByText("Vistoria de imóveis")).toBeDefined();
  });

  it("no horizontal, usa o símbolo reduzido de 28 px", () => {
    const { container } = render(<AvisLockup layout="horizontal" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("width")).toBe("28");
    expect(svg?.querySelectorAll("path")[1]?.getAttribute("stroke-width")).toBe("6");
  });

  it("no vertical, usa o símbolo padrão de 42 px", () => {
    const { container } = render(<AvisLockup layout="vertical" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("width")).toBe("42");
    expect(svg?.querySelectorAll("path")[1]?.getAttribute("stroke-width")).toBe("4");
  });
});
