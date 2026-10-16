# 0018 — Erros decididos pelo type, nunca pelo status

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O mesmo status pode pedir reações diferentes (409 é conflito, idempotência em curso ou `locked`), e status diferentes podem pedir a mesma.

## Decisão

Todo erro é `ProblemDetails` com um `type` do [catálogo](../architecture/backend.md#catálogo-de-erros). O front reage pelo `type` com `switch` exaustivo; 409 e 412 compartilham `version-conflict`.

## Consequências

Cada `type` tem uma reação, e um `type` novo quebra o build do front até ganhar a dele. Custo aceito: o catálogo fechado precisa ser mantido nos dois lados, e todo erro do backend vira uma exceção tipada.
