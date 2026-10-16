# 0017 — Contrato via openapi.json commitado

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Tipos e erros escritos à mão no front divergem da API sem ninguém perceber.

## Decisão

A API gera `apps/api/openapi.json` no build e o arquivo é commitado. O front gera tipos, client, Zod e `ProblemType` a partir dele.

## Consequências

O diff de contrato aparece no PR e o front gera tipos sem a API rodando, inclusive no CI. Custo aceito: um arquivo gerado no repositório que precisa estar sempre atualizado, e todo endpoint precisa de `[EndpointName]`.
