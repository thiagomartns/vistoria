# vistoria

App **local-first** de vistoria de imóveis para locação, usado por vistoriadores autônomos.
Promessa central: nenhum registro feito em campo se perde, e todo registro tem autoria e data verificáveis.
O celular trabalha offline (subsolo, imóvel vazio); o notebook revisa e emite o laudo; as edições convergem.
Front Next.js em static export lê e escreve num banco local e sincroniza por outbox com uma API .NET.
A API é a única fonte de verdade e de segurança. Detalhes em [docs/vision.md](docs/vision.md).

## Mapa do repositório

| Caminho | O que é |
| --- | --- |
| `apps/web/` | Next.js 16, static export ([CLAUDE.md](apps/web/CLAUDE.md)) |
| `apps/api/` | .NET 10, controllers + testes; `openapi.json` gerado no build ([CLAUDE.md](apps/api/CLAUDE.md)) |
| `scripts/` | `screens` (prints do static export), `gen-api` (gerador do contrato, com TypeScript 6), `db-init` (senha local e chave do JWT; `ci-env.mjs` gera as do job `e2e`), `dev-api` (pré-check e `dotnet watch`), `seed` (dados pela API, com o client gerado), `outbox-spike` (roteiro dos spikes 1a e 1b e das duas entregas do M2, pelas telas de clientes, imóveis e vistorias, com os helpers em `lib.mjs`), `conflict-spike` (roteiro do spike 3, a entrega do M3), `shell-spike` (roteiro do spike 4) e `device-spike` (a entrega do M4: aparelho novo, duas abas e pendência protegida) |
| `infra/` | `docker-compose.dev.yml` (SQL Server); senha em `infra/.env`, gerada pelo `pnpm db:init` e nunca commitada |
| `docs/` | Visão, arquitetura e ADRs (`docs/decisions/`) — **o repositório manda** |
| `.github/` | CI (`ci.yml`: jobs `api`, `web`, `e2e`, `security`, obrigatórios na `main`; o `e2e` roda `spike:outbox`, `spike:conflict`, `spike:device` e o `seed` duas vezes contra SQL Server e API de verdade) e Dependabot semanal |
| `.claude/commands/` | `/issue`, `/adr`, `/gen-api`, `/screen` |
| `.mcp.json` | Servidor remoto do MCP do Figma (OAuth, sem token) |

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm db:init` | Gera a senha local em `infra/.env` e grava a connection string e uma chave do JWT nova nos User Secrets; `--rotate` troca a senha sem perder dados |
| `pnpm db:up` / `pnpm db:down` | Sobe / derruba o SQL Server (exige `infra/.env`); com `restart: unless-stopped`, ele volta sozinho depois de um reboot |
| `pnpm dev:api` | Confere o ambiente (outro watch, porta 8080, User Secrets) e sobe o banco se estiver parado; depois `dotnet watch` em `http://localhost:8080` (Swagger em `/swagger`), que aplica as migrações |
| `pnpm dev:web` | `next dev` em `http://localhost:3000` |
| `pnpm check` | Lint (Oxlint), typecheck e testes (Vitest) do web, e testes de `scripts/screens`, `scripts/db-init`, `scripts/dev-api` e `scripts/seed` |
| `pnpm seed` | Cria pela API, com o client gerado, o `dev@vistoria.local`, clientes, imóveis, o roteiro "Apartamento" e N vistorias vivas (`--inspections N`, 200 por padrão), 40% concluídas e uma excluída a mais a cada 10; rodar de novo completa até N sem duplicar (exige `db:up` e `dev:api`) |
| `pnpm gen:api` | Gera tipos, client, Zod e `ProblemType` em `apps/web/src/shared/api/generated/` a partir de `apps/api/openapi.json` |
| `pnpm --filter web build` | Static export em `apps/web/out/`, com o service worker (`sw.js`) |
| `pnpm test:api` | `dotnet test` na solution da API (integração com Testcontainers: exige Docker) |
| `pnpm screens <rota…>` | Prints do static export no celular e no desktop; `--session` entra pelo `/login` (rotas do shell); `--publish` grava na branch `screens`; `--files <dir>` publica PNGs prontos (os do `spike:outbox`) |
| `pnpm spike:outbox` | Roteiro Playwright dos spikes 1a e 1b e das entregas do M2 (cadastro e vistoria offline) contra a API real, no celular e no desktop (exige `db:up`, `dev:api` e o build do web); com `SCREENS=1`, tira os prints dos estados da tela de campo em `.screens/campo/`; com `PULL_CHAOS=1`, o pull roda a cada 1,5 s em vez de 60 s (ainda fora do CI, #145) |
| `pnpm spike:conflict` | Roteiro Playwright do spike 3 (a entrega do M3): dois navegadores do mesmo usuário, celular e desktop, editam a mesma vistoria e o mesmo cliente offline e convergem, com o `ConflictResolver` e os conflitos da exclusão, contra a API real (exige `db:up`, `dev:api` e o build do web); com `SCREENS=1`, os prints em `.screens/conflito/`; aceita `PULL_CHAOS=1` como o `spike:outbox` |
| `pnpm spike:shell` | Roteiro Playwright do spike 4: o shell abre em modo avião depois da primeira visita (exige o build do web; roda no CI) |
| `pnpm spike:device` | Roteiro Playwright da entrega do M4, com o resto do spike 4: um aparelho novo baixa tudo pelo delta e abre em modo avião; duas abas com o access token vencido renovam com um refresh só (e, sem Web Locks, a tolerância da API segura os dois); o pull não toca a pendência do celular, que envia e converge. Contra a API real (exige `db:up`, `dev:api` e o build do web); com `SCREENS=1`, os prints em `.screens/aparelho/`; aceita `PULL_CHAOS=1` |

Uma tela do Figma vira código com `/screen <link> <issue>`.

**MCP do Figma, na primeira sessão:** aprove o servidor `figma` do `.mcp.json` e rode `/mcp` → figma → Authenticate (OAuth no navegador; o token fica fora do repositório).

## Segredos

Nenhum segredo em arquivo versionado, **nem de exemplo** ([ADR 0025](docs/decisions/0025-senha-local-gerada-nunca-de-exemplo.md)).

- `.env.example` só lista nomes (`NOME=`); o valor é gerado pelo `pnpm db:init`. Nunca `cp` do exemplo.
- Nunca imprimir, logar ou pôr em argumento de comando uma senha: compare por hash, passe por stdin ou arquivo.
- Senha exibida ou copiada de algum lugar conta como vazada: `pnpm db:init --rotate`.
- A senha do `dev@vistoria.local` é gerada pelo `pnpm seed` no `infra/.env` (`DEV_USER_PASSWORD`); no CI, pelo
  `ci-env.mjs`. Quem entra como ele (o roteiro do spike 2) a lê de lá, nunca de um literal.
- O `SecretsTests` (API) quebra o CI com valor em `.env.example`, senha literal no compose ou connection
  string em `appsettings*.json`.

## Fluxo de uma issue

1. `/issue <n>`: ler a issue e as seções de `docs/` citadas.
2. Propor um plano em modo de planejamento e **esperar aprovação**.
3. Branch `tipo/NN-slug` (ex.: `feat/42-outbox-retry`); implementar com testes; Conventional Commits.
4. Rodar `pnpm check` e `pnpm test:api`.
5. Abrir o PR com `Closes #NN` e a definição de pronto. Nunca fazer merge: quem revisa faz o squash merge.

Issue que serve à entrega de um marco recebe o milestone dele (`M2 · Escrita confiável` etc.); chore solto fica sem.
O milestone só espelha o marco: o escopo e a entrega verificável continuam nos [Marcos](docs/vision.md#marcos).
Fechar o milestone é conferir a entrega funcionando.

## Definição de pronto

- [ ] Todos os critérios de aceite atendidos e cobertos por teste
- [ ] `pnpm check` e `pnpm test:api` verdes localmente e no CI
- [ ] Se a API mudou: `openapi.json` e o código gerado atualizados no mesmo PR
- [ ] Se uma decisão mudou: ADR novo em `docs/decisions/` e o doc afetado atualizado
- [ ] PR revisado por você

## Leitura

- [docs/vision.md](docs/vision.md): produto, domínio, telas, marcos, glossário, trabalho com o Claude Code
- [docs/architecture/frontend.md](docs/architecture/frontend.md): camada local-first, outbox, formulários, PWA
- [docs/architecture/backend.md](docs/architecture/backend.md): **fonte única do contrato** (rotas, cabeçalhos, erros, prazos)
- [docs/decisions/](docs/decisions/README.md): decisões aceitas; mudar uma é escrever um ADR novo (`/adr`)
