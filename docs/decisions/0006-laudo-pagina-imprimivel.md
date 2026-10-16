# 0006 — Laudo como página imprimível

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O laudo precisa sair mesmo offline, e gerar PDF no servidor exigiria rede e mais infraestrutura.

## Decisão

O laudo é uma página do front com CSS `@media print`; o PDF sai do "Salvar como PDF" do navegador.

## Consequências

Funciona offline e sem serviço de PDF. Custo aceito: o resultado depende do motor de impressão de cada navegador, com pouco controle de paginação, e o servidor não guarda o PDF emitido.
