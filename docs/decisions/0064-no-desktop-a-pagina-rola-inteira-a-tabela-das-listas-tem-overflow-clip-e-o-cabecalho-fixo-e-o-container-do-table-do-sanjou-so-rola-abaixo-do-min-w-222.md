# 0064 — No desktop, a página rola inteira: a tabela das listas tem overflow-clip e o cabeçalho fixo, e o container do Table do Sanjou só rola abaixo do min-w (#222)

- **Status:** Proposto
- **Data:** 2026-11-20

## Contexto

O `main` do shell é uma coluna flex de altura fixa que rola. A partir de 1024 px, a tabela das quatro listas fica numa caixa com borda arredondada e `overflow-hidden` ([ADR 0061](0061-entre-o-celular-e-o-desktop-cada-tela-usa-o-layout-que-cabe-listas-tela-de-campo-e-editor-de-roteiro-208.md), [UX de sincronização e Sanjou UI](../architecture/frontend.md#ux-de-sincronização-e-sanjou-ui)). Um item flex com `overflow-hidden` tem altura mínima 0, então o flex encolhia a caixa até caber na tela e o `main` nunca rolava. Com o seed, a 1440 px dava para ver 15 das 50 vistorias, 18 dos 500 clientes e 18 dos 2.500 imóveis, e o "Mostrar mais" acrescentava linhas escondidas. Nenhum roteiro percebia: o `layout:screens` só olhava o transbordo horizontal, e o `spike:volume` conta as linhas no DOM. O `Table` do Sanjou embrulha a tabela num container com `overflow-x-auto`, que também é contêiner de rolagem e prenderia ali um cabeçalho `sticky`.

## Decisão

No desktop, a página rola inteira, como no celular. A caixa da tabela usa `overflow-clip`: corta os cantos, mas não vira contêiner de rolagem e não encolhe. Cada lista deixa o container do Sanjou `overflow-x-visible` a partir do `min-w` da sua tabela, por container query, e os `th` ficam `sticky` no topo do `main` (`STICKY_TABLE_HEADER`, em `shared/components/list-table.ts`). O `layout:screens` rola cada lista até o fim e confere a última linha e o cabeçalho, também depois do "Mostrar mais".

## Consequências

Toda linha montada fica alcançável, e o cabeçalho continua na tela com a lista rolada. Custos aceitos:
- A busca, os filtros e "Nova vistoria" saem da tela ao rolar. Deixá-los fixos, com a tabela rolando por dentro, muda o desenho e precisa passar pelo Figma.
- Cada lista sobrescreve uma classe interna do `Table` do Sanjou (`*:data-[slot=table-container]`). Se o Sanjou mudar esse container, o cabeçalho deixa de prender sem quebrar o build, e só o `layout:screens` avisa. Um `stickyHeader` no `Table` do Sanjou remove o seletor.
- Abaixo do `min-w`, a tabela continua rolando dentro da borda, e o cabeçalho não fica fixo. A partir de 1024 px, as quatro tabelas cabem.
