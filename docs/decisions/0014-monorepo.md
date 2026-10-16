# 0014 — Monorepo

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Front, API e documentação mudam juntos, e o Claude Code precisa enxergar os três numa sessão.

## Decisão

Um repositório `vistoria` com `apps/web`, `apps/api`, `docs` e `infra`. O Sanjou UI segue no repositório dele e entra como pacote.

## Consequências

Uma mudança de contrato vai num PR só. Custo aceito: o CI cuida de dois ecossistemas (pnpm e dotnet) no mesmo repositório, e web e API não têm versões independentes.
