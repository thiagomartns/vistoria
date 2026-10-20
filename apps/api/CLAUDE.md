# apps/api

API ASP.NET Core 10 com **controllers** (nada de Minimal APIs). É a autoridade: valida, autoriza e detecta
conflito; o cliente só propõe. [backend.md](../../docs/architecture/backend.md) é a **fonte única do contrato**
(rotas, cabeçalhos, catálogo de erros, prazos em "Parâmetros compartilhados").

## Camadas

Controller → Service → Repository, horizontais, como no curso (sem vertical slices).
Pastas em [Estrutura de pastas](../../docs/architecture/backend.md#estrutura-de-pastas).

- **Controllers** (`Controllers/V1/`): rota, binding e status; nenhuma regra de negócio.
- **Services**: regras do agregado, versão, conclusão, delta.
- **Repositories**: acesso ao EF Core, sempre async com `CancellationToken`.
- **Configuração** em extensões `Add*`/`Use*` dentro de `Configurations/`; `Program.cs` só as chama.
- DTOs em `Data/DTO/V1/`. **DTO de entrada** é record ou classe com propriedades `{ get; init; }` e Data
  Annotations; nada de record posicional (a chave do erro sairia em PascalCase) nem do modificador `required`
  (o System.Text.Json falharia antes da validação, sem o caminho do campo). `RequestDtoConventionTests` cobra isso.

## Regras

- **Toda entidade herda de `SyncEntity`** (`Id` Guid do cliente, `Version` rowversion, `CreatedAt`,
  `UpdatedAt`, `DeletedAt`, `OwnerId`). Sem exceção. `Room` e `InspectionItem` só são escritos pelo `PUT`
  da vistoria e não têm versão própria.
- **Erro só por exceção tipada do catálogo** (`Infrastructure/Errors/`), traduzida pelo
  `GlobalExceptionHandler` em `ProblemDetails` com `type`. Nada de `BadRequest("...")` com string.
- **Todo endpoint tem `[EndpointName]` em camelCase** (vira o `operationId` e o nome da função no front).
- **Endpoint que pode falhar declara `[ProblemResponses(...)]`** com os status da tabela de
  [Endpoints](../../docs/architecture/backend.md#endpoints); o OpenAPI os publica como `application/problem+json`.
- **Proibido `FromSqlRaw` com valor externo.** Use LINQ ou `FromSql($"...")` interpolado, que parametriza.
- **Proibido `DateTime.Now`/`UtcNow`.** Use `TimeProvider` (injetado; nos testes, um falso).
- **`apps/api/openapi.json` é regenerado no `dotnet build`** e vai commitado no mesmo PR que mudou a API.
  A geração é incremental (cache em `obj/`): sem a DLL mudar, o arquivo não é reescrito.
- Segredos fora do repositório, nem de exemplo: User Secrets em dev (`pnpm db:init`), variável de ambiente no
  container ([ADR 0025](../../docs/decisions/0025-senha-local-gerada-nunca-de-exemplo.md)).
- Pacotes estáveis apenas; nada de preview/rc.

## Testes

`Vistoria.Api.Tests` com xUnit, `WebApplicationFactory` e AwesomeAssertions (não FluentAssertions).
Testes de integração ficam em `Integration/` e usam `ApiFactory` (`Support/`): a API em Development contra
um SQL Server real do Testcontainers, um container por execução, compartilhado e com a mesma imagem do
`infra/docker-compose.dev.yml`. O startup aplica as migrações como no `pnpm dev:api`. Sem `PriorityOrderer`:
cada teste cria os próprios dados com IDs novos. Testes unitários não sobem o container. Exige Docker.
Cenários esperados em [Testes de integração](../../docs/architecture/backend.md#testes-de-integração).

## Comandos

- `pnpm dev:api` (raiz): `dotnet watch` em `http://localhost:8080`, Swagger em `/swagger`.
- `pnpm test:api` (raiz): `dotnet test` na `Vistoria.sln`.
- `dotnet build` em `apps/api`: compila e regenera `openapi.json` (ou `/gen-api`).
- Migrações (em `apps/api`, depois de `dotnet tool restore`): `dotnet ef migrations add <Nome> --project Vistoria.Api`.
  Em Development o startup aplica as pendentes (`MigrateAsync`); em produção, o `efbundle` no deploy (M5).
  `DatabaseModelTests` falha se o modelo mudou sem migração.
- Connection string `ConnectionStrings:Default`: User Secrets em dev, gravada pelo `pnpm db:init` (raiz),
  `ConnectionStrings__Default` no container. Nunca em `appsettings*.json` (`SecretsTests` cobra).
