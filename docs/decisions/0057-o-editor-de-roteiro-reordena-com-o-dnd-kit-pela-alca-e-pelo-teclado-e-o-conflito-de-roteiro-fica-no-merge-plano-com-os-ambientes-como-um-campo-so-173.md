# 0057 — O editor de roteiro reordena com o dnd-kit, pela alça e pelo teclado, e o conflito de roteiro fica no merge plano com os ambientes como um campo só (#173)

- **Status:** Proposto
- **Data:** 2026-11-12

## Contexto

O editor de roteiros pede "arrastar para ordenar" ambientes e itens ([Telas e fluxo principal](../vision.md#telas-e-fluxo-principal)), no celular com uma mão e no desktop. O app não tinha biblioteca de arrasto: o HTML5 drag and drop não funciona no toque e não tem teclado. A #172 deixou o conflito de roteiro no merge plano por campo, com `rooms` como um campo só, provisório até a tela ([Conflito](../architecture/frontend.md#conflito)). A vistoria casa ambientes e itens pelo `Id`, mas o roteiro é um molde: raramente é editado em dois aparelhos ao mesmo tempo, e a vistoria copia o roteiro e não depende mais dele.

## Decisão

Ambientes e itens se reordenam com `@dnd-kit/core` e `@dnd-kit/sortable` (versões exatas): o arrasto começa só pela alça (`GripVertical`, `touch-none`, 4 px de distância), o teclado faz o mesmo (Espaço pega, setas movem, Espaço solta, Esc cancela), e os anúncios do leitor de tela saem em português. A ordem nova só vai para o servidor no "Salvar roteiro", com a `position` tirada do índice. O conflito de roteiro **fica** no merge plano da #172. Quando os dois lados mudaram os ambientes, o `ConflictResolver` mostra o campo "Ambientes", com a lista resumida de cada lado ("Sala (7 itens), Cozinha (8 itens)"), e escolher um lado leva a lista inteira, na ordem.

## Consequências

Arrastar funciona no toque, no mouse e no teclado, sem desenhar a interação à mão, e o conflito de roteiro reusa o caminho de cliente e imóvel, sem um merge novo. Custos aceitos:
- Três pacotes a mais no bundle das telas de roteiro, que a gente atualiza pelo Dependabot.
- O teste no jsdom precisa simular o `getBoundingClientRect`, porque o dnd-kit mede o layout para mover pelo teclado.
- Com os ambientes mudados nos dois aparelhos, a pessoa escolhe a lista inteira de um lado. Ela perde o que o outro lado fez nos ambientes (um item novo aqui e um ambiente renomeado lá não se juntam) e refaz à mão. Se isso pesar, o merge por `Id` da vistoria serve de modelo.
