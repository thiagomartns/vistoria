# 0012 — Sem sync engine dedicado

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Engines como PowerSync resolvem sync, mas tirariam do projeto o que ele quer estudar e trariam infraestrutura extra.

## Decisão

Sync próprio: delta por cursor e outbox sobre a REST do .NET. PowerSync fica fora do escopo.

## Consequências

Nenhuma peça extra para operar. Custo aceito: escrevemos e mantemos o protocolo de sync; se o spike 2 mostrar que o delta via REST não basta, a decisão volta à mesa.
