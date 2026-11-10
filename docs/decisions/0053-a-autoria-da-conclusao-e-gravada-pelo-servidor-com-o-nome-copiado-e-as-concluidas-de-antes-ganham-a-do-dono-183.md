# 0053 — A autoria da conclusão é gravada pelo servidor com o nome copiado, e as concluídas de antes ganham a do dono (#183)

- **Status:** Proposto
- **Data:** 2026-11-10

## Contexto

O [Produto](../vision.md#produto) promete que todo registro tem autoria e data verificáveis. A conclusão já tinha o `completedAt` do servidor ([ADR 0050](0050-a-vistoria-local-guarda-o-completedat-do-servidor-fora-do-corpo-do-put-a-conclusao-encerra-o-rascunho-e-a-conclusao-recusada-volta-para-inprogress-179.md)), mas a autoria era só implícita, pelo `OwnerId` da conta ([ADR 0003](0003-um-vistoriador-varios-aparelhos.md)). Como a concluída é imutável ([Regra do agregado](../architecture/backend.md#entidade-sincronizável)), a autoria precisa ser gravada na conclusão. O laudo (#168) vai mostrá-la como prova. Havia duas formas de expor o nome: buscar o usuário com um join a cada leitura, ou copiá-lo na conclusão.

## Decisão

O `PUT` que conclui grava `CompletedById` (o usuário do token) e `CompletedByName` (o nome dele naquele momento) junto do `CompletedAt`, nunca a partir do corpo. O `InspectionDto` traz `completedBy: { id, name }` só na concluída. Na migração, as concluídas que já existiam recebem o dono e o nome atual dele. No aparelho, o `completedBy` segue a regra do `completedAt`: a chave só existe na concluída confirmada e nunca vai no `PUT`.

## Consequências

O laudo mostra quem concluiu com o nome daquele dia, mesmo que a pessoa troque de nome depois. A leitura por id e o delta não ganham join ([ADR 0047](0047-lista-de-vistorias-em-paginas-de-50-e-pull-lendo-a-store-por-chave-pela-ordem-do-rowversion-resultado-do-spike-2-134.md)). Como o `UPDATE` da migração sobe o rowversion, o pull reenvia as concluídas antigas e os aparelhos recebem a autoria sem resync nem versão nova do banco local. Custos aceitos:
- O nome fica duplicado em cada concluída e não acompanha uma correção do cadastro: um erro de digitação no nome fica no laudo.
- As concluídas de antes recebem o nome de hoje, não o da conclusão, e a autoria delas é deduzida do dono. Isso só vale porque na V1 a conta tem um vistoriador só: com equipes, a dedução seria falsa.
- O primeiro pull depois do deploy rebaixa todas as concluídas de cada conta.
- A conclusão ainda na fila não tem autoria nem data: a tela segue "concluída neste aparelho" até o 2xx.
