# 0034 — Outbox serial: uma transação por vez, na ordem de criação

- **Status:** Proposto
- **Data:** 2026-10-22

## Contexto

No #74, um imóvel criado offline com um cliente também criado offline precisa chegar ao servidor depois do cliente: antes, o `PUT` do imóvel volta 400 com `clientId` "Cliente não encontrado.". A [Escrita (push)](../architecture/frontend.md#escrita-push) dizia "registros diferentes em paralelo", e os [Parâmetros compartilhados](../architecture/backend.md#parâmetros-compartilhados) diziam até 4 registros, o que pediria uma dependência explícita entre transações. Mas o `KeyScheduler` do `@tanstack/offline-transactions` 1.1.1 (ADR 0030) roda uma transação por vez, em ordem de `createdAt`, e a primeira da fila segura as de trás, mesmo durante o backoff.

## Decisão

A outbox fica serial: uma transação por vez, na ordem de criação, numa fila só para todas as entidades (`features/local-store`). A dependência entre registros vem dessa ordem: o cliente sai antes do imóvel, e depois o roteiro sai antes da vistoria. Se o servidor recusar o registro pai, o filho volta com o erro no campo (`clientId`) e vira rascunho recusado, como qualquer `validation`. O `shared/sync/outbox.order.test.ts` trava esse comportamento com o executor real.

## Consequências

A ordem entre entidades sai sem código de dependência, e vale também depois de recarregar. Custos aceitos:
- Não há envio em paralelo: uma fila longa leva um `PUT` por vez.
- Uma transação em backoff segura a fila inteira. Depois de 24 h, o `OutboxPanel` a mostra como "travada", e ela continua tentando.
- Um upgrade do pacote que mude o agendamento quebra o teste, e nesse caso a dependência explícita vira um ADR novo.
