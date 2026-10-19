# 0023 — Formulários com react-hook-form para usar o Form do Sanjou

- **Status:** Aceito
- **Data:** 2026-10-19

## Contexto

O [stack do front](../architecture/frontend.md#stack) previa TanStack Form + Zod, escolhido porque os nomes de campo usam a mesma notação dos erros do backend (`rooms[2].items[4].condition`). O Sanjou UI tem um `Form` (`FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`) construído sobre o react-hook-form, e o "Form item" dele já aparece em 39 instâncias nos wireframes (issue #13). Com o TanStack Form, o app teria de recriar esses componentes fora do Sanjou, um desvio permanente do design system justamente nos formulários, que são as telas mais importantes.

## Decisão

Os formulários usam react-hook-form, com `@hookform/resolvers/zod` sobre os schemas Zod gerados do contrato, e o `Form` de `@sanjou/ui/form`. O TanStack Form sai do stack. As dependências entram na primeira tela com formulário.

## Consequências

O app usa o `Form` do Sanjou sem cópia local, e o RHF cobre o formulário profundo: `useFieldArray` aninhado para ambientes e itens, `reset` para hidratar do rascunho, `useWatch` com debounce para salvar e `setError` para os erros de `validation`.

Custo aceito:
- **Caminhos.** O RHF usa `rooms.2.items.4.condition` e o backend devolve `rooms[2].items[4].condition`. Uma função única, com teste, converte entre os dois; nenhum outro lugar traduz caminho.
- **React Compiler.** Ler valores com `useWatch`/`useFormState`, nunca com `watch()` no render, porque o compilador pode memoizar o valor e mostrar um dado desatualizado.
- **Tipagem.** Os caminhos ficam um pouco menos tipados que no TanStack Form.
