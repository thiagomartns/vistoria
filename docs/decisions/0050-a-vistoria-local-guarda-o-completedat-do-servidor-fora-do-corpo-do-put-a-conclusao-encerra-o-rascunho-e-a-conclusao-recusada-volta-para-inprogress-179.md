# 0050 — A vistoria local guarda o completedAt do servidor fora do corpo do PUT; a conclusão encerra o rascunho, e a conclusão recusada volta para inProgress (#179)

- **Status:** Proposto
- **Data:** 2026-11-09

## Contexto

Concluir é um `PUT` com `status: completed` pela outbox ([Escrita (push)](../architecture/frontend.md#escrita-push)), e a tela concluída mostra "concluída em 19/10/2026 às 14:32" (Figma 164:12824), como o laudo da #168 vai mostrar. Até aqui o registro local era só o corpo do `PUT` com a `version`: o mapper descartava o `completedAt`, que só o servidor define. O rascunho do formulário profundo ficava "até concluir" ([ADR 0036](0036-rascunho-da-vistoria-guarda-o-passo-e-fica-ate-concluir.md)), mas nada o encerrava. E uma conclusão recusada (400 `validation`) voltaria ao rascunho com `status: completed`: corrigir um chip a reenviaria como conclusão, sem a pessoa pedir.

## Decisão

O registro da vistoria ganha `completedAt?`, só na concluída que o servidor confirmou (a resposta do `PUT`, o pull, o `GET` por id e o `current` de um `locked`). O mapper só põe a chave quando o DTO a traz, e o envio a tira do corpo. Concluir (`completeInspection`) põe o `PUT` na fila e apaga o rascunho. A recusa da conclusão grava o rascunho já em andamento (`reopen` do `upsertMutation`), e a pessoa conclui de novo.

## Consequências

A tela e o laudo leem a data do banco local, offline também, e o merge de uma vistoria em andamento não vê campo novo. Custos aceitos:
- O registro deixa de ser só o corpo do `PUT`: o envio da vistoria precisa tirar o `completedAt`, e um campo do servidor que entrar depois segue o mesmo caminho.
- A concluída baixada antes desta versão não tem a data até o servidor a mandar de novo, e concluída não muda mais. A tela diz só "Vistoria concluída", sem resync nem migração do banco local.
- A conclusão na fila não tem data: a tela diz "concluída neste aparelho" até o 2xx.
