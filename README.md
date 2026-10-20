# vistoria

App local-first de vistoria de imóveis para locação, feito para vistoriadores autônomos.
Funciona offline no celular e sincroniza com a API quando há rede; nenhum registro de campo se perde.

Documentação: [visão do projeto](docs/vision.md), [arquitetura do frontend](docs/architecture/frontend.md) e [do backend](docs/architecture/backend.md).

## Pré-requisitos

- Node.js 24 (`.node-version`) com Corepack habilitado (`corepack enable`), que ativa o pnpm 10 fixado no `package.json`
- .NET SDK 10 (`apps/api/global.json`)
- Docker com Compose

## Primeiros passos

```bash
pnpm install
pnpm db:init   # gera a senha do SQL Server local em infra/.env e grava a connection string nos User Secrets
pnpm db:up
pnpm dev:api   # aplica as migrações pendentes no startup (só em Development)
```

### Segredos locais

Nenhuma senha vai para o repositório, nem de exemplo ([ADR 0025](docs/decisions/0025-senha-local-gerada-nunca-de-exemplo.md)):

- **Não copie** o `infra/.env.example` nem digite senha à mão. Ele só lista os nomes; o `pnpm db:init` gera
  uma senha aleatória por máquina e nunca a imprime.
- **Para trocar a senha** (vazou, foi exibida, foi copiada de algum lugar): `pnpm db:init --rotate` com o
  banco rodando. Troca no SQL Server, no `infra/.env` e nos User Secrets, sem perder dados.
- **Variável nova no `.env`:** acrescente só o nome no `.env.example` (`NOME=`) e gere o valor no
  `pnpm db:init`. O CI (`SecretsTests`) quebra se um `.env.example` tiver valor ou se o compose tiver senha literal.

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm db:init` | Gera a senha local em `infra/.env` e grava a connection string nos User Secrets; `--rotate` troca a senha |
| `pnpm db:up` | Sobe o SQL Server 2022 em container e espera o healthcheck |
| `pnpm db:down` | Derruba o container (o volume com os dados fica) |
| `pnpm dev:api` | API com `dotnet watch` em http://localhost:8080 (Swagger UI em `/swagger`) |
| `pnpm dev:web` | Front com `next dev` em http://localhost:3000 |
| `pnpm check` | Lint, typecheck e testes do front e dos scripts |
| `pnpm test:api` | Testes da API (`dotnet test`); os de integração sobem o SQL Server via Testcontainers e exigem Docker |

O contrato da API fica em `apps/api/openapi.json`, regenerado a cada `dotnet build` e commitado.
