# 0060 — o histórico do imóvel é uma linha do tempo pela data de início, em abas abaixo de 1280 px e num Card ao lado do formulário acima, e a tela de campo e o laudo voltam pelo ?voltar= só com caminho do app (#176)

- **Status:** Proposto
- **Data:** 2026-11-13

## Contexto

A tela do imóvel ([Telas e fluxo principal](../vision.md#telas-e-fluxo-principal)) precisa listar as vistorias dele. A lista empilhada embaixo do formulário, do wireframe 71:3087, ficava depois de uns 650 px de formulário no celular e ocupava só 720 px no desktop. Depois de rascunhos e de uma exploração no Figma (seção "Imóvel · vistorias (#176)"), a escolha foi a linha do tempo. O resumo já tem `propertyId`, tipo, status, início e itens avaliados, mas não o `completedAt` ([ADR 0052](0052-a-saida-guarda-a-referencia-e-as-copias-no-registro-local-so-quando-existem-e-a-nova-vistoria-oferece-as-entradas-pelo-resumo-com-a-fila-por-cima-170.md)). O "Voltar" da tela de campo e do laudo levava sempre para `/inspections`.

## Decisão

O histórico lê o resumo com a fila por cima, como a lista ([ADR 0048](0048-a-lista-de-vistorias-le-um-resumo-gravado-na-mesma-transacao-e-a-vistoria-completa-carrega-por-id.md)), filtrado pelo imóvel e ordenado só pela data de início, da mais nova para a mais antiga. Ele aparece numa linha do tempo, com os componentes locais `Timeline` e `TimelineItem`. A partir de 1280 px, fica num Card ao lado do formulário; abaixo disso, a tela vira abas "Dados | Vistorias · N", com a aba no `?tab=`. A troca entre os dois layouts é feita pelo `useIsWide`, não pelo CSS, porque o formulário não pode existir duas vezes na página. Os itens abrem a tela de campo e o laudo com `?voltar=` apontando para o histórico; o `?voltar=` só vale com um caminho do app (começando por `/`, sem `//` nem `/\`), e qualquer outro valor leva para a lista.

## Consequências

O histórico usa o que o aparelho já tem, sem migração e sem mudança na API, e o "Voltar" devolve a pessoa para onde ela estava. Custos aceitos:
- A meta da concluída mostra o início, não a conclusão, e a em andamento não sobe para o topo: quem a procura se guia pelo marcador vazado.
- Entre 768 e 1279 px, o desktop também usa abas. Ao cruzar 1280 px, a tela troca de layout, e um primeiro quadro do prerender pode sair com abas.
- O `?voltar=` é mais um parâmetro de rota. O "Ver laudo" da tela de campo o repassa, mas a tela de conflito não o recebe.
