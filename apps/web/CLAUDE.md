# apps/web

Shell Next.js 16 em **static export**, sem servidor em produção. A UI lê e escreve só no banco local;
a rede é detalhe da camada de sync. Arquitetura completa em [frontend.md](../../docs/architecture/frontend.md);
o contrato (status, cabeçalhos, `type` de erro, prazos) vem só de [backend.md](../../docs/architecture/backend.md).

Hoje existem só `src/app/` e `src/shared/`; a árvore de `features/` e `shared/` descrita em
[Estrutura de pastas](../../docs/architecture/frontend.md#estrutura-de-pastas) é o alvo.

## Camadas e fronteiras de import

Fluxo: models → schemas → services → hooks → components → page.

| Camada | Pode importar | Nunca importa |
| --- | --- | --- |
| page | hooks, components | services, `api/` |
| components | Sanjou UI, outros components | hooks de dados, services |
| hooks | services, schemas | `api/generated` direto |
| services | models, schemas, `shared/*` | React |

Essas fronteiras são regra, não convenção (viram regras de lint).

## Regras

- **Erro se decide pelo `ProblemType`, nunca pelo status HTTP.** `handleProblem` em `shared/api/problems.ts`
  faz `switch` exaustivo; um `type` novo tem de quebrar o build até ganhar reação.
- **Nunca editar `src/shared/api/generated/`.** É saída do gerador OpenAPI; muda via `pnpm gen:api` (M1).
- **`If-Match` e `Idempotency-Key` só na outbox** (`shared/sync/outbox.ts`), nunca em componente ou hook.
- **Rotas sem segmento dinâmico.** Nada de `[id]`: o id vai na query string (`/inspections/edit?id=`),
  lido com `useSearchParams` dentro de `Suspense`. Static export não aceita rota dinâmica com id de runtime.
- Proibido no static export: Server Components com dados, Server Actions, middleware, rotas de API, ISR.
- **Usar os componentes do Sanjou UI e nunca recriá-los** com `div` e classes. Componente que falta vira
  issue no repositório do Sanjou; a tela usa um placeholder marcado até ele sair.
- React Compiler ligado: sem `useMemo`/`useCallback` manuais.

## Comandos (rodar dentro de `apps/web` ou com `pnpm --filter web`)

`dev`, `build`, `lint` (Oxlint), `format` (Oxfmt), `typecheck`, `test` (Vitest), `check` (lint + typecheck + test).

## Figma → Sanjou

_Preenchida no MD_ (ver [Das telas no Figma para o código](../../docs/vision.md#das-telas-no-figma-para-o-código)).
