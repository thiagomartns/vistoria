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

Uma vez por máquina (e de novo se mudar a senha), grave a connection string da API nos User Secrets, fora do
repositório. O comando lê a senha de `MSSQL_SA_PASSWORD` no `infra/.env`; não digite a senha à mão (o `!` da
senha de exemplo dispara a expansão de histórico do zsh e do bash):

```bash
dotnet user-secrets set ConnectionStrings:Default \
  "Server=localhost,1433;Database=vistoria;User Id=sa;Password=$(sed -n 's/^MSSQL_SA_PASSWORD=//p' infra/.env);TrustServerCertificate=True" \
  --project apps/api/Vistoria.Api
```

Depois disso, `pnpm dev:api` aplica as migrações pendentes no startup (só em Development).

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm db:up` | Sobe o SQL Server 2022 em container e espera o healthcheck |
| `pnpm db:down` | Derruba o container (o volume com os dados fica) |
| `pnpm dev:api` | API com `dotnet watch` em http://localhost:8080 (Swagger UI em `/swagger`) |
| `pnpm dev:web` | Front com `next dev` em http://localhost:3000 |
| `pnpm check` | Lint, typecheck e testes do front |
| `pnpm test:api` | Testes da API (`dotnet test`); os de integração sobem o SQL Server via Testcontainers e exigem Docker |

O contrato da API fica em `apps/api/openapi.json`, regenerado a cada `dotnet build` e commitado.
