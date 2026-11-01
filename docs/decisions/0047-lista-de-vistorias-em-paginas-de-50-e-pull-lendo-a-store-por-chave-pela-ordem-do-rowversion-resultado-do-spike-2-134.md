# 0047 — Lista de vistorias em páginas de 50 e pull lendo a store por chave pela ordem do rowversion (resultado do spike 2, #134)

- **Status:** Proposto
- **Data:** 2026-11-01

## Contexto

O [spike 2](../architecture/frontend.md#riscos-e-spikes) (`pnpm spike:volume`) mediu 10 mil vistorias (380 mil itens) contra metas fixadas antes de medir. No celular, com CPU 4×, o primeiro pull levou 162 s (meta 120 s) e a live query, 9 s (meta 500 ms). O reload offline passou de 60 s. Os perfis acharam três causas. A lista montava as 10 mil linhas, duas vezes (Table e ListRow), com um formatador `Intl` novo por data. O pull lia a store confirmada inteira (`exportData`, 42 MB) duas vezes por página, para a conferência do [ADR 0044](0044-o-pull-nao-aplica-resposta-mais-velha-que-o-aparelho-e-a-fila-conta-como-pendencia.md), cujo custo o spike 2 tinha de medir. A outbox lia a store inteira a cada envio, para achar um registro.

## Decisão

Complementa o 0044. A lista de `/inspections` monta 50 linhas por vez, com "Mostrar mais", e as datas saem de formatadores reaproveitados. A página do delta lê da store confirmada só os ids dela, pelo `readConfirmed` (`shared/db/local-db.ts`), e a outbox lê só o registro do envio. A conferência do 0044 compara o rowversion: o item mais velho que a store ganha a marca, sem a cópia da store antes da requisição. Só o resync, que é raro, lê a store inteira.

## Consequências

Primeiro pull de 162 s para 20,9 s no celular (11,0 s no desktop); live query de 9 s para 140 ms (43 ms); tela de campo em 403 ms (337 ms); banco local de 42 MB. Custos aceitos:
- O front passa a depender de a `version` ser o rowversion em base64, que só cresce ([backend.md](../architecture/backend.md#leitura-por-delta)), e o servidor falso dos testes também.
- O `readConfirmed` lê a store pelo nome e pela chave, como a collection IndexedDB grava, e não por uma API dela. Um teste contra um IndexedDB em memória (`fake-indexeddb`) quebra se a 0.15 mudar isso.
- A lista só mostra tudo depois de vários "Mostrar mais", até a busca e os filtros do M5.
- O reload offline até a lista segue fora da meta: 3,7 s no celular (meta 2 s) e 1,66 s no desktop (meta 1 s). A collection restaura as 10 mil vistorias completas antes de a lista existir, sem carga sob demanda. A lista pelo resumo fica na #154, e o roteiro imprime essa meta como pendente.
