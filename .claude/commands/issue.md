---
description: Trabalha uma issue do GitHub de ponta a ponta (plano, aprovação, implementação, PR)
argument-hint: <número da issue>
---

Trabalhe a issue #$ARGUMENTS seguindo o fluxo do [CLAUDE.md](../../CLAUDE.md).

1. **Ler.** Rode `gh issue view $ARGUMENTS --comments`. Leia as seções de `docs/` citadas em Contexto e
   Notas técnicas, e o `CLAUDE.md` da área afetada (`apps/web/` ou `apps/api/`). Se a issue diz
   "Depende de #N", confira com `gh issue view N` que a dependência está fechada; se não estiver, pare e avise.
2. **Planejar.** Entre em modo de planejamento e proponha um plano: arquivos a criar ou mudar, testes que
   provam cada critério de aceite, e o que fica fora de escopo. **Espere minha aprovação** antes de editar
   qualquer arquivo.
3. **Branch.** A partir da `main` atualizada (`git switch main && git pull`), crie `tipo/NN-slug`, com
   `tipo` vindo do label `type:*` (`feat`, `fix`, `chore`, `spike`, `design`) e `NN` = $ARGUMENTS.
   Exemplo: `feat/42-outbox-retry`.
4. **Implementar com testes.** Siga as regras dos `CLAUDE.md`. Commits no padrão Conventional Commits.
   Se a API mudou, rode `dotnet build` em `apps/api` e inclua o `openapi.json` regenerado.
   Se uma decisão mudou, crie um ADR com `/adr`.
5. **Checar.** Rode `pnpm check` e `pnpm test:api`. Os dois precisam estar verdes; se algo falhar, corrija
   e rode de novo. Não desligue nem pule teste para passar.
6. **PR.** `git push -u origin HEAD` e `gh pr create` com:
   - título no padrão Conventional Commits;
   - resumo do que mudou e por quê;
   - a linha `Closes #$ARGUMENTS`;
   - a checklist da definição de pronto, marcada conforme o que foi verificado:

   ```markdown
   - [ ] Todos os critérios de aceite atendidos e cobertos por teste
   - [ ] `pnpm check` e `pnpm test:api` verdes localmente e no CI
   - [ ] Se a API mudou: `openapi.json` e o código gerado atualizados no mesmo PR
   - [ ] Se uma decisão mudou: ADR novo em `docs/decisions/` e o doc afetado atualizado
   - [ ] PR revisado por você
   ```

Não faça merge. Termine mostrando o link do PR e o resultado dos checks.
