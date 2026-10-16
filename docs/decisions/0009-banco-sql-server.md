# 0009 — Banco: SQL Server

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O curso que serve de base usa SQL Server, inclusive nos testes com Testcontainers.

## Decisão

SQL Server 2022 em dev, testes e produção.

## Consequências

`rowversion` nativo serve de versão (ETag) e de cursor do delta. Custo aceito: imagem pesada para dev e CI, e um banco que só roda em container x64.
