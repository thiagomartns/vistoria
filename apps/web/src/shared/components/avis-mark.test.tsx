import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { AvisLockup } from "./avis-lockup";
import { AvisMark } from "./avis-mark";

const BEAM_SMALL = "M28 14 47 45.67V57H27.2L17 31.5V28A15 15 0 0 1 26.61 14Z";
const BEAM = "M26 14 48 53.29V60H28.56L16.18 25.61A16 16 0 0 1 24.25 14Z";

function paths(container: HTMLElement) {
  const [beam, arch] = [...container.querySelectorAll("path")];
  return { beam: beam?.getAttribute("d"), stroke: arch?.getAttribute("stroke-width") };
}

describe("AvisMark", () => {
  it.each([16, 24, 28, 31])("usa a versão reduzida com %i px", (size) => {
    const { container } = render(<AvisMark size={size} />);

    expect(paths(container)).toEqual({ beam: BEAM_SMALL, stroke: "6" });
  });

  it.each([32, 42, 64])("usa a versão padrão com %i px", (size) => {
    const { container } = render(<AvisMark size={size} />);

    expect(paths(container)).toEqual({ beam: BEAM, stroke: "4" });
  });

  it('é uma imagem chamada "Avis"', () => {
    render(<AvisMark />);

    expect(screen.getByRole("img", { name: "Avis" })).toBeDefined();
  });

  it("aceita outro nome acessível", () => {
    render(<AvisMark title="Avis, início" />);

    expect(screen.getByRole("img", { name: "Avis, início" })).toBeDefined();
  });

  it("decorativo, fica fora da árvore de acessibilidade", () => {
    const { container } = render(<AvisMark decorative />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.hasAttribute("role")).toBe(false);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("cores da marca", () => {
  const cases: [string, ReactElement][] = [
    ["AvisMark padrão", <AvisMark key="d" size={64} />],
    ["AvisMark reduzido", <AvisMark key="s" size={24} />],
    ["AvisLockup horizontal", <AvisLockup key="h" layout="horizontal" caption />],
    ["AvisLockup vertical", <AvisLockup key="v" layout="vertical" caption />],
  ];

  it.each(cases)("%s só usa classes de token do Sanjou", (_, element) => {
    const { container } = render(element);
    const [beam, arch] = [...container.querySelectorAll("path")];

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|style=/i);
    expect(beam?.hasAttribute("fill")).toBe(false);
    expect(arch?.hasAttribute("stroke")).toBe(false);
    expect(beam?.getAttribute("class")).toBe("fill-brand dark:fill-brand-text");
    expect(arch?.getAttribute("class")).toBe("stroke-foreground");
  });

  it.each(["avis-mark.tsx", "avis-lockup.tsx"])("%s não tem cor em hexadecimal", (file) => {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
