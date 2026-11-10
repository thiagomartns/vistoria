# 0052 — a saída guarda a referência e as cópias no registro local só quando existem, e a Nova vistoria oferece as entradas pelo resumo com a fila por cima (#170)

- **Status:** Proposto
- **Data:** 2026-11-10

## Contexto

A saída nasce no aparelho, offline, copiando a entrada concluída ([Regras de negócio](../vision.md#regras-de-negócio)); desde a #169 a API grava `referenceInspectionId` e a cópia dos itens na criação e as ignora depois ([ADR 0051](0051-kind-referencia-e-copias-da-saida-sao-da-criacao-o-put-de-atualizacao-os-ignora-169.md)). O registro local omitia os três campos. Pô-los em todo registro mudaria a forma das entradas já gravadas no aparelho: o merge veria um campo a mais entre a base antiga e o servidor, e o pull regravaria tudo. A Nova vistoria também precisa saber quais entradas concluídas do imóvel o aparelho tem, mas a lista só lê o resumo de cada vistoria, e a completa carrega por id ([ADR 0048](0048-a-lista-de-vistorias-le-um-resumo-gravado-na-mesma-transacao-e-a-vistoria-completa-carrega-por-id.md)).

## Decisão

Como o `completedAt` ([ADR 0050](0050-a-vistoria-local-guarda-o-completedat-do-servidor-fora-do-corpo-do-put-a-conclusao-encerra-o-rascunho-e-a-conclusao-recusada-volta-para-inprogress-179.md)), a referência só existe quando há uma: `referenceInspectionId` na saída, e `referenceCondition` e `referenceNotes` no item copiado da entrada. O mapper só põe as chaves quando o DTO as traz, e o envio as manda como estão. A Nova vistoria lista as entradas concluídas do imóvel pelo resumo, com a fila por cima, a mais recente escolhida, e lê inteira só a escolhida.

## Consequências

A entrada e os registros já no aparelho não mudam, sem migração do banco local, e a entrada concluída offline já serve de base (a outbox é serial, a conclusão chega antes da saída). Custos aceitos:
- O rótulo da entrada fica no que o resumo tem, "Entrada de 20/10/2026 às 14:30 · 29 itens", e não "concluída em … · 6 ambientes" como no wireframe 68:1646: o resumo não guarda nem o `completedAt` nem o número de ambientes.
- A entrada que o aparelho não tem (de outro aparelho, ainda não baixada pelo pull) não aparece: a saída parte só do que está no banco local.
- Um item sem chave de cópia e um com a chave nula são formas diferentes: quem criar item na saída (#171) não põe a chave.
