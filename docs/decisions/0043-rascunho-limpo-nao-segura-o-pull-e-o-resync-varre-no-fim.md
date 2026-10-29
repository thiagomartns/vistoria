# 0043 — Rascunho limpo não segura o pull, e o resync varre no fim

- **Status:** Proposto
- **Data:** 2026-10-29

## Contexto

A tela de campo grava um rascunho `draft` logo depois de abrir, mesmo sem mudança, e ele fica até concluir ([ADR 0036](0036-rascunho-da-vistoria-guarda-o-passo-e-fica-ate-concluir.md)). Como o [ADR 0041](0041-o-pull-nao-toca-registro-com-pendencia.md) conta como pendência "um rascunho de qualquer status", uma vistoria aberta uma vez nunca mais receberia o pull. O notebook que revisa enquanto o celular trabalha não veria nada. Além disso, a [Leitura (pull)](../architecture/frontend.md#leitura-pull) mandava o resync apagar a collection antes de puxar do zero. O cursor vence depois de muito tempo offline, e uma queda no meio do resync deixaria o aparelho sem as vistorias confirmadas.

## Decisão

Complementa o 0041 em dois pontos:
- **Rascunho limpo.** Um rascunho `draft` com os valores do registro, sem transação na fila, não é pendência. O pull grava a versão nova e refaz o rascunho por cima dela (`rebaseDraft`): o passo fica, e a tela aberta recarrega mantendo o que a pessoa marcou e ainda não gravou.
- **Resync em `cursor-expired` ou `invalid-cursor`.** O resync zera o cursor, marca "resync em curso" e puxa do zero gravando por cima do que o aparelho já tem. Só no fim apaga o que não veio, menos o que tem pendência, que ganha a marca. Se cair no meio, o ciclo seguinte recomeça do zero.

Depois do primeiro pull completo da entidade, a leitura por id não pede mais o `GET`.

## Consequências

O notebook revisando recebe o que o celular grava, e a collection nunca fica vazia durante um resync. Custos aceitos:
- Na janela do debounce do rascunho (300 ms), uma marcação no mesmo item que o outro aparelho mudou vence sem conflito, como na janela do [ADR 0042](0042-pull-grava-a-pagina-antes-do-cursor-e-reaplica-sem-efeito.md).
- O resync que cai baixa tudo de novo.
- Um link para uma vistoria criada em outro aparelho depois do último pull mostra "não existe ou foi excluída" até o próximo pull trazê-la.
