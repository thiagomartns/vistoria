# 0030 — TanStack DB mantido após o spike 1a (outbox persistida contra o upsertClient)

- **Status:** Aceito
- **Data:** 2026-10-21

## Contexto

O [ADR 0016](0016-local-first-tanstack-db-outbox.md) apostou no TanStack DB, pré-1.0, com plano B em TanStack Query e outbox própria ([Riscos e spikes](../architecture/frontend.md#riscos-e-spikes)). O spike 1a (#59) testou a parte do aparelho contra o `PUT /api/v1/clients/{id}`, com `@tanstack/db` 0.14.0, `@tanstack/react-db` 0.5.9 e `@tanstack/offline-transactions` 1.1.1. O roteiro `pnpm spike:outbox` (Playwright, API e SQL Server reais) passou nos seis passos. Offline, criar e editar mostra o valor na hora. Depois do reload, o registro e as transações voltam com as mesmas chaves. Com a rede de volta, cada `PUT` sai uma vez, com `Authorization` e a sua `Idempotency-Key`. Com a resposta derrubada, o reenvio usa a mesma chave e o mesmo corpo. Um 500 tenta de novo com backoff, e um 400 `validation` sai da fila sem laço.

## Decisão

O TanStack DB fica, e o plano B não é acionado. As versões ficam fixadas exatas (sem `^`): saíram quatro minors em duas semanas. A store IndexedDB (`indexedDBCollectionOptions`) guarda só o que o servidor confirmou, e o pendente vive na outbox, que o reaplica como otimista ao abrir. O começo de `shared/sync/outbox.ts` e de `features/clients/services/` contorna o que o pacote não resolve:
- a chave padrão é v4, então `enqueue` passa uma v7 nossa;
- a política padrão de retry decide pelo texto da mensagem ("401", "400"), então o `shouldRetry` decide pelo `ReactionGroup` do `handleProblem`;
- uma transação leva um registro só, porque uma chave vale para um corpo;
- o pacote não exporta `OfflineMutationFn`, e o `acceptMutations` é tipado sem o item da collection.

## Consequências

A camada de sync segue o desenho do frontend.md sem outbox própria. Custos aceitos:
- O backoff é só exponencial (1 s a 60 s); o `Retry-After` fica para o M2, num contorno.
- A outbox não emite eventos, e a tela relê o `peekOutbox` em intervalo.
- Só a aba líder persiste a outbox; as outras escrevem online-only até o M4 tratar várias abas.
- O reload offline do roteiro bloqueia só a API: sem service worker (spike 4), o shell não abre offline.
- `renew-session` retenta até o M4 trazer a pausa com refresh. Idempotência e `If-Match` no servidor são do spike 1b.
