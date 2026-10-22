# 0032 — Serwist pelo CLI sobre o static export, build com Turbopack

- **Status:** Proposto
- **Data:** 2026-10-22

## Contexto

O [frontend.md](../architecture/frontend.md#shell-next-pwa-e-rotas) previa `next build --webpack` "por exigência do Serwist", para usar o plugin `@serwist/next`. Esse plugin pré-cacheia `.next/static` e o HTML pré-renderizado, mas não o que o static export realmente serve em `out/`, como os payloads RSC (`*.txt`) da navegação no cliente. O Serwist 9.5 também tem o modo CLI: `serwist build` empacota o `sw.ts` com esbuild e injeta a lista do pré-cache a partir de uma pasta qualquer. O spike 4 (#71) precisa abrir o app em modo avião, inclusive numa rota com `?id=`.

## Decisão

O build é `next build && serwist build serwist.config.mjs`, com Turbopack. O `serwist.config.mjs` pré-cacheia o `out/` inteiro (HTML, `.txt`, chunks, fontes, ícones, manifest). O `src/sw.ts` só faz pré-cache, sem runtime caching. A API nunca passa pelo service worker. Com `ignoreURLParametersMatching: [/.*/]` e o `cleanURLs` padrão, `/clients/edit?id=…` é servido pelo `clients/edit.html` pré-cacheado.

## Consequências

O que o service worker guarda é exatamente o que o servidor de produção serve. O build não troca de bundler, e o roteiro `pnpm spike:shell` prova no CI que o shell abre offline (cada página vem do service worker). Custos aceitos:
- Duas dependências de build: `@serwist/cli` e `esbuild`.
- O `sw.ts` tem um tsconfig próprio (`tsconfig.sw.json`, lib `webworker`), fora do typecheck do app.
- Todo arquivo do export entra no install (cerca de 1,9 MB hoje). Cresce com as telas, sem cache sob demanda.
- Sem `skipWaiting`: a versão nova espera todas as abas fecharem. O aviso "Nova versão disponível", com a outbox vazia, fica para outra issue.
