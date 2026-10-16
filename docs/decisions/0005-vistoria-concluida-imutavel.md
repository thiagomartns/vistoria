# 0005 — Vistoria concluída é imutável

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O laudo vale como prova; um registro que muda depois de concluído perde esse valor.

## Decisão

Depois de concluída, qualquer `PUT` ou `DELETE` na vistoria responde 409 `locked` com `current`.

## Consequências

O laudo é confiável. Custo aceito: conclusão por engano não se desfaz; correção pós-conclusão fica para um adendo numa versão futura; o front precisa tratar `locked` adotando `current`.
