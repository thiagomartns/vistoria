# 0066 — As listas de clientes e imóveis também em páginas de 50, e cada lista monta só a versão da largura (#223)

- **Status:** Proposto
- **Data:** 2026-11-22

## Contexto

Com o `pnpm seed`, `/clients` montava as 500 linhas e `/properties` as 2.500 de uma vez. Cada lista montava também as duas versões, a `Table` e as `ListRow`, com uma escondida pelo CSS em `lg` ([ADR 0061](0061-entre-o-celular-e-o-desktop-cada-tela-usa-o-layout-que-cabe-listas-tela-de-campo-e-editor-de-roteiro-208.md)). Eram 5.000 links no DOM de `/properties`. `/inspections` já paginava em 50 ([ADR 0047](0047-lista-de-vistorias-em-paginas-de-50-e-pull-lendo-a-store-por-chave-pela-ordem-do-rowversion-resultado-do-spike-2-134.md)), mas também montava as duas versões. O `spike:volume` passou a medir as duas listas em modo avião, com metas fixadas antes de medir: do menu até a lista, 1 s no celular (CPU 4×) e 500 ms no desktop, e a busca, 500 ms e 200 ms. Na `main`, `/properties` levava 1,45 s no celular. A alternativa era virtualizar (TanStack Virtual). Mas, com a página rolando inteira e o cabeçalho fixo ([ADR 0064](0064-no-desktop-a-pagina-rola-inteira-a-tabela-das-listas-tem-overflow-clip-e-o-cabecalho-fixo-e-o-container-do-table-do-sanjou-so-rola-abaixo-do-min-w-222.md)), isso pede linhas espaçadoras e altura medida numa `<table>`.

## Decisão

Complementa o 0047 e o 0061. `/clients` e `/properties` montam 50 linhas por vez, com "Mostrar mais" e o contador no desktop, como `/inspections`, pelo `LIST_PAGE_SIZE` de `shared/list-page.ts`. A busca e os filtros correm sobre todos os registros antes do corte, e mudar um deles volta para a primeira página. Cada lista (vistorias, clientes, imóveis e roteiros) monta uma versão só: a tela escolhe pelo `useIsLarge` e passa o `layout` (`tabela` ou `linhas`) para a lista.

## Consequências

No celular, `/properties` caiu de 1,45 s para 158 ms do menu até a lista, e `/clients` de 327 ms para 154 ms. A busca caiu de 332 ms para 121 ms e de 138 ms para 90 ms. No desktop, tudo ficou abaixo de 45 ms. O reload offline de `/inspections` foi de 1,59 s para 1,16 s. Custos aceitos:
- Ver a lista inteira pede vários "Mostrar mais"; achar um registro é pela busca, como em `/inspections`.
- A versão da lista vem do JavaScript, não do CSS. No prerender, ela seria a do celular, mas a lista só aparece com o banco local aberto, depois da hidratação. Os testes precisam simular a largura (`shared/viewport.harness.ts`).
- O `spike:volume` quebra se uma lista montar links escondidos, e os roteiros contam só os links visíveis.

Afeta [UX de sincronização e Sanjou UI](../architecture/frontend.md#ux-de-sincronização-e-sanjou-ui), no layout das listas, e o Spike 2, em [Riscos e spikes](../architecture/frontend.md#riscos-e-spikes).
