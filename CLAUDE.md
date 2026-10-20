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
| `scripts/` | `screens` (prints do static export) e `gen-api` (gerador do contrato, com TypeScript 6) |
| `infra/` | `docker-compose.dev.yml` (SQL Server); senha em `infra/.env`, nunca commitado |
| `docs/` | Visão, arquitetura e ADRs (`docs/decisions/`) — **o repositório manda** |
| `.github/` | CI (`ci.yml`: jobs `api`, `web`, `security`, obrigatórios na `main`) e Dependabot semanal |
| `.claude/commands/` | `/issue`, `/adr`, `/gen-api`, `/screen` |
| `.mcp.json` | Servidor remoto do MCP do Figma (OAuth, sem token) |

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm db:up` / `pnpm db:down` | Sobe / derruba o SQL Server (exige `infra/.env`) |
| `pnpm dev:api` | `dotnet watch` em `http://localhost:8080` (Swagger em `/swagger`) |
| `pnpm dev:web` | `next dev` em `http://localhost:3000` |
| `pnpm check` | Lint (Oxlint), typecheck e testes (Vitest) do web, e testes do `scripts/screens` |
| `pnpm gen:api` | Gera tipos, client, Zod e `ProblemType` em `apps/web/src/shared/api/generated/` a partir de `apps/api/openapi.json` |
| `pnpm --filter web build` | Static export em `apps/web/out/` |
| `pnpm test:api` | `dotnet test` na solution da API |
| `pnpm screens <rota…>` | Prints do static export no celular e no desktop; `--publish` grava na branch `screens` |

`pnpm seed` chega no M2. Uma tela do Figma vira código com `/screen <link> <issue>`.

**MCP do Figma, na primeira sessão:** aprove o servidor `figma` do `.mcp.json` e rode `/mcp` → figma → Authenticate (OAuth no navegador; o token fica fora do repositório).

## Fluxo de uma issue

1. `/issue <n>`: ler a issue e as seções de `docs/` citadas.
2. Propor um plano em modo de planejamento e **esperar aprovação**.
3. Branch `tipo/NN-slug` (ex.: `feat/42-outbox-retry`); implementar com testes; Conventional Commits.
4. Rodar `pnpm check` e `pnpm test:api`.
5. Abrir o PR com `Closes #NN` e a definição de pronto. Nunca fazer merge: quem revisa faz o squash merge.

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
