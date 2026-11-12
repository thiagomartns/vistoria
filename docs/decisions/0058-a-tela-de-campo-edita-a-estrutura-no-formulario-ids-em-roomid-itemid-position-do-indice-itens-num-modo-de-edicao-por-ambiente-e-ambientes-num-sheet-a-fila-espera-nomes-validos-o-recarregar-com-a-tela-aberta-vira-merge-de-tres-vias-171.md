# 0058 — A tela de campo edita a estrutura no formulário (ids em roomId/itemId, position do índice); itens num modo de edição por ambiente e ambientes num Sheet; a fila espera nomes válidos; o recarregar com a tela aberta vira merge de três vias (#171)

- **Status:** Proposto
- **Data:** 2026-11-12

## Contexto

A H6 pede adicionar, remover e reordenar o que o roteiro não previa ([Histórias da versão 1](../vision.md#histórias-da-versão-1)). O formulário da tela de campo guardava só `condition` e `notes` por posição; a estrutura vinha do registro ([Formulários profundos](../architecture/frontend.md#formulários-profundos)). O `PUT` já leva `rooms` e `items` como lista completa, e o merge já casa ambientes e itens pelo `Id` ([Conflito](../architecture/frontend.md#conflito)). Um nome vazio ou acima de 60 chega a existir no meio da edição, e o servidor recusaria esse corpo.

## Decisão

O formulário passa a ter os ambientes e os itens na ordem da tela, com `roomId`/`itemId` (o `id` é a chave do `useFieldArray`), o nome, a condição e a observação; o registro sai da lista do formulário, com a `position` do índice e o resto (observação do ambiente, cópia da saída) do registro pelo id. Os itens se editam num modo por ambiente ("Editar itens", "Pronto"), com a `SortableList` do roteiro, que sobe para `shared/components`; os ambientes, num `Sheet` aberto pelo "···". O rascunho grava sempre, mas a fila só recebe a vistoria com nomes de 1 a 60 e as listas no limite (`structureErrors`, sobre o Zod gerado). Uma versão nova com a tela aberta recarrega o formulário pelo merge de três vias (base = os valores salvos, local = os da tela, servidor = a versão nova), e o que saiu na versão nova sai como o servidor tem (ADR 0043).

## Consequências

Incluir, renomear, remover e reordenar valem offline e no merge de dois aparelhos, sem endpoint nem merge novos. Custos aceitos:
- Com um nome inválido, a vistoria fica só no rascunho, sem "Não enviado" na fila até a pessoa corrigir; "Pronto" e Próximo não saem da edição para ela não esquecer.
- Remover item não pede confirmação, nem com a condição marcada: a lixeira só aparece no modo de edição, que é deliberado.
- O último ambiente não sai, para a tela sempre ter um passo; mover item entre ambientes fica para depois (o merge já mantém o id).
