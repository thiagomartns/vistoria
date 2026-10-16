# 0001 — Domínio: vistoria de imóveis para locação

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O estudo de sync local-first precisa de um domínio com offline estrutural e formulário profundo por natureza. Detalhes no [Modelo de domínio](../vision.md#modelo-de-domínio).

## Decisão

Vistoria de imóveis para locação: `Client`, `Property`, `Template` e o agregado `Inspection` → `Room` → `InspectionItem`.

## Consequências

O domínio exercita de verdade offline, agregado de três níveis e conflito. Custo aceito: regras de negócio próprias (conclusão, saída a partir da entrada) para modelar além do sync.
