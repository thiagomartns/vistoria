# 0007 — Busca e listagem só no banco local

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O front já mantém todos os dados do usuário no aparelho para funcionar offline.

## Decisão

Busca e listagem acontecem só no banco local do front. A API não expõe listagem paginada nem busca.

## Consequências

Busca instantânea e offline, e menos endpoints. Custo aceito: o aparelho precisa ter tudo baixado antes de buscar, e o volume local precisa caber no navegador (medido no spike 2).
