# 0003 — Um vistoriador, vários aparelhos

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O público é o vistoriador autônomo, que trabalha sozinho com celular e notebook.

## Decisão

Um usuário edita seus próprios dados em vários aparelhos; tudo tem escopo por `OwnerId`. Equipes e portal da imobiliária ficam fora.

## Consequências

Autorização simples (todo acesso filtra por `OwnerId`) e conflito só entre aparelhos do mesmo dono. Custo aceito: suportar equipes depois exige rever escopo, delta e autorização.
