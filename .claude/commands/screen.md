---
description: Implementa uma tela a partir de um frame do Figma (plano, aprovação, código, prints, PR)
argument-hint: <link do Figma> <número da issue>
---

Implemente a tela do frame do Figma para a issue, seguindo [Das telas no Figma para o código](../../docs/vision.md#das-telas-no-figma-para-o-código)
e o fluxo do [CLAUDE.md](../../CLAUDE.md). Argumentos: `$ARGUMENTS`.

0. **Argumentos.** O primeiro é o link do frame (Copy link to selection), o segundo é o número da issue.
   Do link `figma.com/design/<fileKey>/...?node-id=<a>-<b>`, tire o `fileKey` e o nó `<a>:<b>`. Se faltar
   o link, o `node-id` ou a issue, pare e peça. O arquivo esperado é o "vistoria — app" (`BJDaQ12Mlx1YCdKwjETHmE`).
1. **Ler.** Rode `gh issue view <issue> --comments` e confira que cada "Depende de #N" está fechada; se não
   estiver, pare e avise. Leia as seções de `docs/` citadas, o [apps/web/CLAUDE.md](../../apps/web/CLAUDE.md)
   e o mapa completo em [figma-sanjou.md](../../docs/architecture/figma-sanjou.md).
2. **Ler o frame** pelo MCP do Figma: `get_screenshot` e `get_design_context` do nó. Se o frame for grande
   e o contexto vier só como estrutura, use `get_metadata` e leia os filhos (desktop, celular, cada estado)
   um a um. Monte o inventário de cada instância:
   - **Sanjou UI:** import pelo mapa. Nunca recriar com `div` e classes o que existe no pacote.
   - **Componente local** (página "Componentes novos"): `@/shared/components/` pelo mapa. Se ainda não
     existe no código, entra no plano para ser implementado só com primitivos e tokens do Sanjou (ADR 0020).
   - **Fora do mapa ou não desenhado** em "Componentes novos": pare e pergunte. Componente que falta é
     desenhado no Figma antes, nunca improvisado na tela.
3. **Planejar.** Entre em modo de planejamento e proponha:
   - a rota, sem segmento dinâmico (id na query string), e os arquivos a criar ou mudar;
   - a tabela "nó do Figma → import" e os componentes locais a criar;
   - os hooks da feature que entregam os dados (o dado nunca entra direto no componente; se o hook
     não existe, diga se entra nesta issue ou se ela depende de outra);
   - cada estado do frame (vazio, offline, enviando, conflito...) e o teste que o prova;
   - as rotas e os estados que terão print, e o que fica fora de escopo.

   **Espere minha aprovação** antes de editar qualquer arquivo.
4. **Branch.** A partir da `main` atualizada (`git switch main && git pull`), crie `tipo/NN-slug`, com
   `tipo` vindo do label `type:*` da issue.
5. **Implementar com testes.** Page → hooks → components, com as fronteiras e as regras do
   `apps/web/CLAUDE.md`. Componentes recebem dados por props; um teste (Testing Library) por estado do
   frame. Se um nome de export ou um componente local mudar, atualize o `figma-sanjou.md` no mesmo PR.
   Commits no padrão Conventional Commits.
6. **Checar.** Rode `pnpm check` e `pnpm test:api`. Os dois precisam estar verdes; não desligue nem pule
   teste para passar.
7. **Prints no celular e no desktop.**
   - `pnpm --filter web build && pnpm screens <rota…>` gera `.screens/<rota>-celular.png` (390×844) e
     `.screens/<rota>-desktop.png` (1440×900), em página inteira, nos tamanhos dos frames do Figma.
   - Abra os prints e compare com o screenshot do frame: componentes, textos, espaçamento, estados.
     Corrija as divergências e tire de novo.
   - Estado que depende de dado local entra pelo `pnpm seed` quando ele existir. Até lá, diga no PR quais
     estados estão só nos testes.
   - `pnpm screens <rota…> --publish` grava os PNGs na branch órfã `screens` (uma pasta por branch) e
     imprime a tabela em markdown para o PR.
8. **PR.** `git push -u origin HEAD` e `gh pr create` com:
   - título no padrão Conventional Commits;
   - resumo do que mudou, o link do frame e a tabela de prints (celular × desktop);
   - a linha `Closes #<issue>`;
   - a checklist da definição de pronto, marcada conforme o que foi verificado:

   ```markdown
   - [ ] Todos os critérios de aceite atendidos e cobertos por teste
   - [ ] `pnpm check` e `pnpm test:api` verdes localmente e no CI
   - [ ] Se a API mudou: `openapi.json` e o código gerado atualizados no mesmo PR
   - [ ] Se uma decisão mudou: ADR novo em `docs/decisions/` e o doc afetado atualizado
   - [ ] PR revisado por você
   ```

Não faça merge. Termine mostrando o link do PR, a tabela de prints e o resultado dos checks.
