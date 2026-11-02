# 0048 — A lista de vistorias lê um resumo gravado na mesma transação, e a vistoria completa carrega por id

- **Status:** Proposto
- **Data:** 2026-11-02

## Contexto

Depois do [ADR 0047](0047-lista-de-vistorias-em-paginas-de-50-e-pull-lendo-a-store-por-chave-pela-ordem-do-rowversion-resultado-do-spike-2-134.md), a última meta do [spike 2](../architecture/frontend.md#riscos-e-spikes) seguia fora: o reload offline até a lista levava 3,7 s no celular com CPU 4× (meta 2 s) e 1,66 s no desktop (meta 1 s). A collection IndexedDB do TanStack DB 0.15 faz o `getAll` da store inteira ao começar (10 mil vistorias completas, 42 MB), sem carga sob demanda. Toda tela a começava: o `useLocalStore` assinava as vistorias, e o pull dava `preload` nelas.

## Decisão

A vistoria completa fica numa collection nossa, `on-demand`, sobre a mesma store (`shared/db/summarized-collection.ts`). Ela só carrega por id (`eq` ou `inArray` no `id`); qualquer outra consulta quebra. A tela de campo e o `ConflictResolver` a leem por id. A mesma gravação (`acceptMutations`, por onde passam pull, outbox e conflitos) grava, numa transação IndexedDB só, a vistoria e o resumo dela na store `inspectionSummaries`, então os dois nunca divergem. A lista lê os resumos numa store em memória simples, não numa collection, e põe por cima o que a fila tem e os rascunhos. Na primeira abertura, os resumos são montados a partir das vistorias.

## Consequências

Reload offline até a lista de 3,7 s para 1,6–1,8 s no celular e de 1,66 s para 0,7 s no desktop; as outras metas seguem cumpridas (`pnpm spike:volume`, que agora afirma as cinco). Custos aceitos:
- A gravação da vistoria deixa de ser a da collection IndexedDB do TanStack: a nossa repete o modelo dela (gravar e confirmar, e um `BroadcastChannel` entre abas), sem o `_versions`. Ela é coberta por testes contra o `fake-indexeddb`.
- O `get` da collection só vê o que uma consulta ou o `load(ids)` carregou. A pendência e o "mudou durante o `GET`" se conferem com o confirmado lido por chave, e a exclusão pela lista carrega a vistoria antes de marcar.
- A linha de uma alteração recém-feita entra na lista em até 1 s, no ritmo do badge: a fila é lida a cada segundo.
- O resumo fora do TanStack não tem live query nem camada otimista. Montar a collection custava uns 300 ms no celular, e a fila já vem por cima na lista.
