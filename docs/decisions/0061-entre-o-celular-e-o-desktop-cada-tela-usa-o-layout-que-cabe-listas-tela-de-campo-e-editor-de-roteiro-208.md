# 0061 — Entre o celular e o desktop, cada tela usa o layout que cabe: listas, tela de campo e editor de roteiro (#208)

- **Status:** Proposto
- **Data:** 2026-11-14

## Contexto

O Figma só tem frames de 390 e 1440 px, e as telas trocavam do celular para o desktop em `md` (768 px) ([UX de sincronização e Sanjou UI](../architecture/frontend.md#ux-de-sincronização-e-sanjou-ui)). O teste manual e uma sondagem a 768, 1024 e 1279 px acharam várias quebras. Com a sidebar, o conteúdo tem 478 px a 768 e 734 a 1024. As colunas fixas das tabelas somavam até 880 px, então a primeira coluna ficava com 0 px e o cabeçalho dela passava por cima do vizinho. Na tela de campo, o trilho de ambientes e o item com 5 chips de 96 px só cabem com 1072 px de formulário (uns 1360 de janela): a 768 o nome quebrava letra a letra, e até 1279 os chips passavam da borda. O editor de roteiro deixava uns 70 px para os itens. A barra de imóveis empurrava o "Novo imóvel" para fora da tela.

## Decisão

Cada tela usa o layout do desktop só onde ele cabe, e no resto usa o do celular, que já está desenhado. Abaixo de `lg` (1024 px), as quatro listas e as barras delas ficam como no celular, com o `ListRow`. A partir de `lg`, a tabela tira as colunas secundárias pela largura dela, por container query (`hidden @min-[Npx]:table-cell`): cada limite deixa 180 px para a primeira coluna, e o `min-w` da tabela é o piso, com rolagem dentro da borda. A tela de campo troca pela largura da própria `StepperForm`, com a variante `stepper-wide` (`@container stepper (width >= 1072px)`, no `globals.css`), que a `StepperForm`, o `InspectionItem`, o `RoomStep` e o `ToggleGroup` (tamanho `stepper`) usam. Abaixo dela, a partir de `md`, o layout do celular fica dentro do card, sem nada preso sobre o padding do shell. O editor de roteiro tem dois painéis a partir de `lg`, pelo `useIsLarge`. O `pnpm layout:screens` confere tudo isso de 768 a 1440 px no CI.

## Consequências

Nenhuma tela quebra entre o tablet e o desktop, e o tablet ganha os alvos de toque do celular. Custos aceitos:
- Entre 768 e 1023 px, um notebook estreito vê as listas como no celular. Entre 1024 e 1440 px, a tabela mostra menos colunas que o Figma.
- A tela de campo fica no layout do celular até uns 1360 px de janela, então muito notebook (1280, ou 1366 com zoom) não vê o trilho de ambientes. O layout intermediário, com trilho e item empilhado, precisaria de tela nova no Figma.
- Os limites (1072 e os das colunas) são somas feitas à mão. Mudar a largura de um chip, do trilho ou de uma coluna é refazer a conta.
- O `ToggleGroup` e o `InspectionItem`, candidatos ao Sanjou, passam a depender do container `stepper` da `StepperForm`.
