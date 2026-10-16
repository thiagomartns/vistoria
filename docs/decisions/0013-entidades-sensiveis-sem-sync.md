# 0013 — Entidades sensíveis não sincronizam

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Dado guardado no aparelho pode vazar; classificar campos sensíveis no front é frágil.

## Decisão

Entidades sensíveis simplesmente não têm endpoint de sync. O que não sincroniza nunca chega ao aparelho.

## Consequências

O front não precisa classificar nada. Custo aceito: esses dados não ficam disponíveis offline, e qualquer tela que dependa deles só funciona online.
