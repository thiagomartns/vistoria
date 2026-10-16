# 0002 — Fotos fora da V1

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Fotos por item são esperadas numa vistoria, mas sincronizar arquivos offline é um tema inteiro: upload retomável, quota do navegador, armazenamento no servidor.

## Decisão

Fotos ficam fora da V1 e entram na V2. O modelo já reserva o lugar delas.

## Consequências

A V1 foca no sync de dados estruturados. Custo aceito: o laudo da V1 sai sem evidência fotográfica, e a V2 terá de acrescentar armazenamento de arquivos e uma fila de upload.
