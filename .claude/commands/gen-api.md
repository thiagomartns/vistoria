---
description: Regenera apps/api/openapi.json e explica o que mudou no contrato
---

Regenere o contrato da API e explique o diff.

1. Rode `dotnet build` em `apps/api` (é o build que grava `apps/api/openapi.json`). Se o build falhar,
   mostre o erro e pare.
2. Rode `git diff --stat -- apps/api/openapi.json` e `git diff -- apps/api/openapi.json`.
3. Se não houver diff, diga que o contrato já está atualizado. Lembre que a geração é incremental
   (cache em `obj/`): se você esperava mudança, confira se o código da API mudou de fato.
4. Se houver diff, explique em linguagem de contrato, agrupado por tipo de mudança:
   - endpoints e `operationId` adicionados, removidos ou renomeados;
   - schemas (DTOs) com campos novos, removidos, renomeados ou com tipo/obrigatoriedade diferente;
   - respostas de erro, cabeçalhos e o enum `ProblemType`;
   - o que é **mudança que quebra o front** e o que é compatível.
5. Confira que todo endpoint novo tem `operationId` em camelCase (vem do `[EndpointName]`).

A geração de tipos, client, Zod e `ProblemType` no front (`pnpm gen:api`) entra no M1; até lá este
comando só cuida do `openapi.json`. Não faça commit sem eu pedir.
