# 0037 — Entregáveis pelo vision.md e pelo milestone, sem Project

- **Status:** Proposto
- **Data:** 2026-10-26

## Contexto

O [Backlog no GitHub](../vision.md#backlog-no-github) previa um Project com colunas e o campo Marco, e o `CLAUDE.md` passou a pedir o milestone do marco a partir do M2. No fim do M2, o marco de cada issue estava em três lugares (Marcos, milestone e campo Marco) e o andamento em dois (estado da issue e coluna). O Project ficou para trás: issues fechadas em "Backlog" ou "Em revisão", e issues do M2 fora dele. Os backlogs em checkbox do M0 e do MD nos [Marcos](../vision.md#marcos) também seguiam desmarcados com o trabalho feito.

## Decisão

Cada pergunta tem uma fonte só. O `vision.md` define o marco (escopo e entrega verificável), o milestone agrupa as issues que servem à entrega e o estado da issue e do PR ligado diz o andamento. O Project foi fechado. MD e M1 ganharam milestones retroativos, já fechados, a partir do campo Marco.

## Consequências

Nada para mover à mão, e o `gh` e o `/issue` já leem o milestone. Custos aceitos:
- Sem quadro, "próximo" e "em andamento" não aparecem em lugar nenhum: a próxima issue sai do milestone do marco atual, na ordem combinada na sessão.
- O M0 não tem milestone (as tarefas dele são anteriores às issues), e chore solto continua sem.
- A descrição do milestone repete a entrega verificável; quando o marco muda, o `vision.md` muda primeiro e o milestone é acertado no mesmo PR.
