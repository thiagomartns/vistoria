# 0015 — Controllers em camadas, não vertical slices

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O esforço de estudo deve ir para o que é novo (concorrência, idempotência, sync), e o curso de base usa camadas horizontais.

## Decisão

Controllers com Controller → Service → Repository. Nada de vertical slices nem Minimal APIs.

## Consequências

Estrutura conhecida e o curso continua servindo de consulta. Custo aceito: uma feature se espalha por várias pastas; reorganizar por feature depois é mover pastas, não reescrever.
