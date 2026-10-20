---
description: Regenera apps/api/openapi.json e o código gerado do front, e explica o que mudou no contrato
---

Regenere o contrato da API e o código gerado do front, e explique o diff.

1. Rode `dotnet build` em `apps/api` (é o build que grava `apps/api/openapi.json`). Se o build falhar,
   mostre o erro e pare.
2. Rode `pnpm gen:api` na raiz (grava `apps/web/src/shared/api/generated/` a partir do `openapi.json`).
3. Rode `git diff --stat -- apps/api/openapi.json apps/web/src/shared/api/generated` e
   `git diff -- apps/api/openapi.json`.
4. Se não houver diff, diga que o contrato já está atualizado. Lembre que a geração é incremental
   (cache em `obj/`): se você esperava mudança, confira se o código da API mudou de fato.
5. Se houver diff, explique em linguagem de contrato, agrupado por tipo de mudança:
   - endpoints e `operationId` adicionados, removidos ou renomeados;
   - schemas (DTOs) com campos novos, removidos, renomeados ou com tipo/obrigatoriedade diferente;
   - respostas de erro, cabeçalhos e o enum `ProblemType`;
   - o que é **mudança que quebra o front** e o que é compatível.
6. Confira que todo endpoint novo tem `operationId` em camelCase (vem do `[EndpointName]`).
7. Rode `pnpm --filter web typecheck`: uma mudança que quebra o front aparece aqui, inclusive um `type` novo
   sem reação no `handleProblem`.

O `openapi.json` e o gerado vão no mesmo commit. Não faça commit sem eu pedir.
