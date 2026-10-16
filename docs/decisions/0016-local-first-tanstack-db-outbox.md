# 0016 — Local-first com TanStack DB e outbox

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O vistoriador trabalha sem sinal e não pode perder registro feito em campo.

## Decisão

A UI lê e escreve só no banco local (TanStack DB). Toda escrita vai para uma outbox durável, enviada com `If-Match` e `Idempotency-Key`. Ver [Camada de dados](../architecture/frontend.md#camada-de-dados-local-first).

## Consequências

O app funciona offline e não perde trabalho. Custo aceito: TanStack DB é pré-1.0 (isolado em `services/`, com plano B em TanStack Query + outbox própria), e conflito e merge de três vias são nossos para implementar.
