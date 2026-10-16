# 0008 — Exclusão só de vistoria em andamento, com tombstones

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Os aparelhos precisam saber o que sumiu, e vistorias concluídas ou cadastros referenciados por elas são prova.

## Decisão

Só vistoria em andamento é excluída, por soft delete (`DeletedAt`); tombstones ficam 90 dias. Cliente, imóvel e roteiro não são excluídos na V1.

## Consequências

O delta entrega exclusões e nada se apaga em cascata. Custo aceito: as tabelas crescem com tombstones; um cursor com mais de 90 dias exige resync completo (410 `cursor-expired`); cadastro errado fica para sempre na V1.
