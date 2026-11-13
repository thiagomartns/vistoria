import { useSyncExternalStore } from "react";

// Os breakpoints do Tailwind para o que o CSS não troca sozinho: `md` (768 px), como o placeholder de um Input, e `xl`
// (1280 px), como o formulário do imóvel ao lado do histórico, que não pode existir duas vezes na página. Layout
// continua no CSS. No prerender do static export e no jsdom sem matchMedia, é o celular.

const DESKTOP = "(min-width: 768px)";
const WIDE = "(min-width: 1280px)";

function subscribe(query: string, listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

const matches = (query: string) =>
  typeof window !== "undefined" && !!window.matchMedia?.(query).matches;

const subscribeDesktop = (listener: () => void) => subscribe(DESKTOP, listener);
const subscribeWide = (listener: () => void) => subscribe(WIDE, listener);

/** A tela tem ao menos 768 px de largura. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => matches(DESKTOP), () => false);
}

/** A tela tem ao menos 1280 px de largura. */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => matches(WIDE), () => false);
}
