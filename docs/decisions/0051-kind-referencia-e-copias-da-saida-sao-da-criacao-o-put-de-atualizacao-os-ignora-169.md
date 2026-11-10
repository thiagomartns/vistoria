# 0051 — kind, referência e cópias da saída são da criação; o PUT de atualização os ignora (#169)

- **Status:** Proposto
- **Data:** 2026-11-10

## Contexto

A saída nasce de uma entrada concluída: o front copia ambientes e itens com ids novos e preenche `referenceCondition` e `referenceNotes` ([Regras de negócio](../vision.md#regras-de-negócio)). Até a #169, `referenceInspectionId` e as cópias ficavam fora do corpo de entrada ([Regra do agregado](../architecture/backend.md#entidade-sincronizável)). A issue pedia decidir se um `PUT` que altere a referência depois de criada responde 400 ou é ignorado. Pesa que todo `PUT` leva o registro local inteiro, inclusive o corpo de um merge, e que um 400 volta ao rascunho com o erro num campo que o vistoriador não edita: a transação ficaria presa. O `kind` está amarrado à regra: virar saída depois exigiria uma referência que já não pode ser posta, e voltar a ser entrada deixaria a referência órfã.

## Decisão

`kind`, `referenceInspectionId` e as cópias dos itens valem só na criação, com as regras dela (a saída aponta para uma entrada concluída, viva, do mesmo imóvel e do mesmo dono; a entrada não tem referência nem cópia). Num `PUT` de atualização, esses campos são ignorados, como o `startedAt`. Item novo numa saída já criada nasce sem cópia. Mudar o imóvel de uma saída é 400 em `propertyId`.

## Consequências

O front reenvia o corpo inteiro sem cuidar do que é da criação, e a resposta traz o valor gravado, que ele adota. Custos aceitos:
- Um corpo com valor diferente nesses campos passa sem aviso: um bug do front que os troque não aparece como erro, só como o valor do servidor na resposta.
- O tipo de uma vistoria não muda mais depois de criada. Quem errou o tipo exclui a vistoria (se ainda estiver em andamento) e cria outra. O roteiro do spike 2, que trocava o tipo para medir a live query, passou a trocar o imóvel.
- O servidor não confere se as cópias batem com a entrada: confia na cópia do front, sempre do mesmo dono.
