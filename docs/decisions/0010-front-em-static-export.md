# 0010 — Front em static export

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Sem servidor Next em produção, não há superfície de Server Components nem SSR para proteger ou operar.

## Decisão

Next.js em static export: só arquivos estáticos, sem SSR nem páginas públicas.

## Consequências

Menos superfície de ataque e hospedagem trivial. Custo aceito: sem rotas dinâmicas (o id vai na query string), sem middleware, Server Actions, rotas de API, ISR ou otimização de imagem em runtime.
