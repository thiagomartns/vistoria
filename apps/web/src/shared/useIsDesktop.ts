import { useSyncExternalStore } from "react";

// O breakpoint `md` do Tailwind (768 px), para o que o CSS não troca sozinho, como o placeholder de um Input. Layout
// continua no CSS. No prerender do static export e no jsdom sem matchMedia, é o celular.

const QUERY = "(min-width: 768px)";

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

const isDesktop = () => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches;

/** A tela tem ao menos 768 px de largura. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, isDesktop, () => false);
}
