# 0036 — Rascunho da vistoria guarda o passo e fica até concluir

- **Status:** Proposto
- **Data:** 2026-10-26

## Contexto

Na tela de campo (#94), fechar a aba no meio de um ambiente e reabrir precisa trazer os valores e o ambiente atual. Os valores já voltam da outbox, mas o passo do stepper só existe no rascunho. Os [Formulários profundos](../architecture/frontend.md#formulários-profundos) diziam que o "rascunho sincronizado é apagado", e o `clearDraft` apagava o rascunho a cada 2xx e a cada novo envio, levando o passo junto. Com o formulário editável e a transação na fila ([ADR 0021](0021-formulario-editavel-com-transacao-na-fila.md)), o rascunho também pode ter valores mais novos que a transação recusada.

## Decisão

O rascunho do formulário profundo (o que tem `step`) recebe os valores e o ambiente atual a cada mudança e fica no status `draft` até a vistoria ser concluída ou descartada (M5). O 2xx e um novo envio só tiram a recusa ou o conflito dele (status volta a `draft`, sem `errors` e sem `conflict`). Recusa e conflito mudam o status e os erros, e mantêm os valores e o passo que a pessoa deixou. Rascunho sem `step` (cliente, imóvel) segue como antes.

## Consequências

Reabrir a tela de campo volta ao mesmo ambiente com o que foi marcado, mesmo com a aba fechada antes de a mudança chegar à fila. O custo aceito: toda vistoria aberta deixa um rascunho no aparelho até concluir, e a lista precisa ignorar o status `draft` (só `rejected` e `conflict` vencem o registro). A recusa de uma transação antiga aparece sobre valores mais novos, que talvez já corrijam o erro, até o próximo envio confirmar. O pull do M4 terá de tratar o rascunho `draft` ao trazer uma versão de outro aparelho, porque hoje o rascunho vence o registro na abertura.
