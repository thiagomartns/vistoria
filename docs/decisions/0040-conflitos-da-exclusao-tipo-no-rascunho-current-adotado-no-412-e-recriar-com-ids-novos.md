# 0040 — Conflitos da exclusão: tipo no rascunho, current adotado no 412 e recriar com ids novos

- **Status:** Proposto
- **Data:** 2026-10-28

## Contexto

A #109 implementa os passos 4 e 5 do [Conflito](../architecture/frontend.md#conflito), desenhados no #107: um `PUT` que volta 410 `deleted` (excluída em outro aparelho) e um `DELETE` que volta 412 (alterada depois que a pessoa a abriu). O doc não dizia o que o "Cancelar" do "Excluir mesmo assim?" faz, e o rascunho em conflito não distinguia esses casos do conflito de edição. Os ids de ambiente e item da vistoria excluída continuam usados no servidor ([backend.md](../architecture/backend.md), exclusão só da raiz). O 410 real também revelou que o Zod gerado recusava data com fuso (`+00:00`): o `ProblemDetails` virava ilegível e a transação tentava de novo para sempre.

## Decisão

O `ConflictDetail` ganha `type` (`deleted` ou `removal`; sem ele, edição). O 410 guarda o local, a base e o `deletedAt`. Recriar põe a vistoria na fila com ids novos na raiz, nos ambientes e nos itens, sem `If-Match`. Descartar a tira do aparelho sem requisição. No 412 do `DELETE`, o `current` vai para a store confirmada na hora. "Excluir mesmo assim" é uma exclusão nova, com chave nova e a versão do `current`. "Cancelar" só tira o conflito, e o × sai sem decidir. O gerador do contrato passa a aceitar data com fuso (`dates.offset`).

## Consequências

A tela de campo do estado 8 mostra o que o servidor tem, e as duas saídas reusam o fluxo da exclusão e da edição, sem envio especial. Custos aceitos:
- O `current` entra na store antes da escolha, então até "Excluir mesmo assim" a vistoria local já é a do outro aparelho.
- Recriar gera outro código, e o que ainda estivesse na fila para o id antigo é perdido de propósito. Um 410 de vistoria já descartada ou recriada só sai da fila.
- Com a tela de campo só leitura no `removal`, a pessoa não edita nada até decidir.
- `locked` no `DELETE` continua só desfazendo a marca, até o M5.
