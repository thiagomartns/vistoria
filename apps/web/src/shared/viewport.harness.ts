import { act } from "@testing-library/react";
import { vi } from "vitest";

// A largura da tela nos testes, para o `useIsDesktop`, o `useIsLarge` e o `useIsWide` (`useIsDesktop.ts`): o jsdom não
// tem `matchMedia`, e sem ele os hooks dizem celular. `stubWidth` liga um `matchMedia` que responde ao `min-width` das
// queries pela largura de agora; `resizeTo` muda a largura com a tela montada, como o `layout:screens` faz trocando o
// viewport, e avisa os hooks. Desligar com `vi.unstubAllGlobals()`.

let width = 0;
const listeners = new Set<() => void>();

const matchesWidth = (query: string): boolean => {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  return min ? width >= Number(min[1]) : false;
};

/** A tela passa a ter `px` de largura, para as próximas montagens. */
export function stubWidth(px: number): void {
  width = px;
  listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return matchesWidth(query);
    },
    media: query,
    addEventListener: (_: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_: "change", listener: () => void) => listeners.delete(listener),
  }));
}

/** Com a tela montada, muda a largura para `px` e avisa quem escuta. */
export function resizeTo(px: number): void {
  act(() => {
    width = px;
    for (const listener of [...listeners]) listener();
  });
}
