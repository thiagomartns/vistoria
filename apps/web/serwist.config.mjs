// `serwist build` (depois do `next build`): empacota src/sw.ts com esbuild e injeta a lista do pré-cache,
// lida do static export em `out/` (ADR 0032). O que o export serve é o que o app precisa offline.

/** @type {import("@serwist/build").BuildOptions} */
export default {
  swSrc: "src/sw.ts",
  swDest: "out/sw.js",
  globDirectory: "out",
  globPatterns: ["**/*.{html,txt,js,css,woff2,svg,png,ico,webmanifest,json}"],
  globIgnores: ["sw.js", "404.html", "_not-found.*", "_not-found/**"],
  // Os arquivos de `_next/static/` já têm hash no nome.
  dontCacheBustURLsMatching: /^_next\/static\//,
  // Fontes e chunks de página passam do limite padrão de 2 MiB só em casos raros; o teto fica explícito.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
};
