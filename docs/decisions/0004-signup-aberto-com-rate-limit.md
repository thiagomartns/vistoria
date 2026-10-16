# 0004 — Cadastro aberto com rate limit

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

A V1 não tem administração nem fluxo de convite, e o público é individual.

## Decisão

`signup` aberto, protegido por rate limit (5 por minuto por IP, ver [Parâmetros compartilhados](../architecture/backend.md#parâmetros-compartilhados)).

## Consequências

Qualquer pessoa cria conta sem aprovação. Custo aceito: contas descartáveis são possíveis e um limite por IP é contornável; convite ou aprovação, se precisar, vira decisão nova.
