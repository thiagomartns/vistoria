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
cp infra/.env.example infra/.env   # senha do SA do SQL Server local
pnpm db:up
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm db:up` | Sobe o SQL Server 2022 em container e espera o healthcheck |
| `pnpm db:down` | Derruba o container (o volume com os dados fica) |
| `pnpm dev:api` | API com `dotnet watch` em http://localhost:8080 (Swagger UI em `/swagger`) |
| `pnpm dev:web` | Front com `next dev` em http://localhost:3000 |
| `pnpm check` | Lint, typecheck e testes do front |
| `pnpm test:api` | Testes da API (`dotnet test`) |

O contrato da API fica em `apps/api/openapi.json`, regenerado a cada `dotnet build` e commitado.
