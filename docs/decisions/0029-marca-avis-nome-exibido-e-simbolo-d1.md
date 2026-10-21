# 0029 — Marca Avis: nome exibido e símbolo D1

- **Status:** Aceito
- **Data:** 2026-10-21

## Contexto

O app mostrava o codinome `vistoria` como nome, e o login tinha um "Logo placeholder" do pattern Auth do Sanjou. O autor fez uma marca com o Claude Design: o nome "Avis" e o símbolo D1 "Anunciação", uma janela em arco atravessada por um feixe de luz. O guia cita um token `logo-accent`, que não existe no `@sanjou/tokens` 0.2.0. O desenho entrou no Figma pela #61 e o guia em [docs/design/brand/](../design/brand/README.md).

## Decisão

"Avis" é o nome exibido (`APP_NAME`, título da aba, login, sidebar), com o símbolo D1. "vistoria" continua o nome técnico (repo, pacotes, rotas, arquivo do Figma) e o substantivo na UI ("Nova vistoria"). As cores são tokens do Sanjou, sem token novo: arco em `foreground`, luz em `brand`, e `brand-text` no escuro.

## Consequências

A marca acompanha o tema sozinha e não abre exceção no design system. Custos aceitos:
- "Avis" também é marca registrada de uma locadora de carros. Para um projeto de estudo, isso basta; se o projeto virar produto, uma busca no INPI é necessária antes de usar o nome, e o nome pode ter de mudar.
- O favicon é um arquivo estático e não lê variáveis CSS, então repete os hexadecimais do Sanjou e precisa ser atualizado à mão se a paleta mudar.
- No Figma, `brand` vale o mesmo índigo nos dois modos, então a luz no escuro (`brand-text`) só aparece no código.
- Dois nomes convivem: quem lê o código vê `vistoria`, quem usa o app vê Avis.
