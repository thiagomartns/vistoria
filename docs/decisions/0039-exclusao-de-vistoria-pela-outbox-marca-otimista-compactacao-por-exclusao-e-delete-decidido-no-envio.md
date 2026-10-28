# 0039 — Exclusão de vistoria pela outbox: marca otimista, compactação por exclusão e DELETE decidido no envio

- **Status:** Proposto
- **Data:** 2026-10-28

## Contexto

A #108 leva o `deleteInspection` para a outbox única ([Escrita (push)](../architecture/frontend.md#escrita-push), [ADR 0034](0034-outbox-serial-uma-transacao-por-vez-na-ordem-de-criacao.md)). Pelo design do #107, a exclusão não é otimista: a linha fica "Excluindo" e só some no 204, para um conflito no `DELETE` encontrá-la onde estava. Só que o executor 1.1.2 restaura toda mutação como `optimistic: true` ao recarregar, então um `delete` com `optimistic: false` voltaria otimista. Além disso, uma edição pendente não pode chegar ao servidor depois do `DELETE`, e uma vistoria criada offline e nunca enviada não precisa de `DELETE`. Por fim, com a página visível, o `WebOnlineDetector` diz "online" mesmo sem rede, então a primeira escrita offline é tentada na hora.

## Decisão

A exclusão é uma transação na fila serial. Se o servidor já confirmou a vistoria, a mutação é um `update` otimista que só põe `deleting: true` (campo local, fora de qualquer corpo); se não, é um `delete` otimista e a linha some na hora. O `DELETE` se decide no envio, pela store confirmada: sai com `If-Match` da versão dela, ou não sai requisição nenhuma quando o servidor nunca aceitou a vistoria. Uma exclusão compacta as escritas nunca tentadas do mesmo registro que estão antes dela; um `PUT` anterior que volta com `version-conflict` ou `deleted`, com a exclusão na fila, sai da fila sem merge reenviado. O rascunho é descartado ao confirmar.

## Consequências

A ordem entre a edição e a exclusão sai da fila, sem código novo de dependência, e o "Excluindo" sobrevive ao reload. Custos aceitos:
- `deleting` é um campo local no `InspectionRecord`, e `saveInspection` e `saveInspectionDraft` precisam ignorar o registro marcado.
- Uma escrita já tentada (inclusive a primeira feita offline, por causa do detector) não é compactada: ela sai antes do `DELETE`, com a mesma chave, e o servidor a vê antes de excluir.
- Cancelar a exclusão pelo `OutboxPanel` fica para uma issue própria, porque o executor não tira uma transação da fila.
- O 412 e o `locked` no `DELETE` só desfazem a marca, até a #109 e o M5.
