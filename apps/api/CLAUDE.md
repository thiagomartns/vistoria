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

- **Toda entidade do domínio herda de `SyncEntity`** (`Id` Guid do cliente, `Version` rowversion, `CreatedAt`,
  `UpdatedAt`, `DeletedAt`, `OwnerId`). A exceção são `Room` e `InspectionItem`: só são escritos pelo `PUT` da
  vistoria, herdam de `AggregateChild` (`Id` e `DeletedAt`, sem versão) e, ao mudar, sobem a versão da vistoria no
  `SaveChangesAsync`, que exige a vistoria rastreada
  ([ADR 0035](../../docs/decisions/0035-ambiente-e-item-do-agregado-sobre-aggregatechild-sem-syncentity.md)).
  Só as de autenticação e infraestrutura (`User`, `RefreshToken`, `IdempotencyRecord`) ficam fora ([ADR 0026](../../docs/decisions/0026-usuario-e-entidades-de-autenticacao-fora-do-syncentity-senha-de-8-a-128-caracteres-sem-regra-de-composicao.md)).
- **Erro só por exceção tipada do catálogo** (`Infrastructure/Errors/`), traduzida pelo
  `GlobalExceptionHandler` em `ProblemDetails` com `type`. Nada de `BadRequest("...")` com string.
- **Rota exige access token por padrão** (fallback policy). Só `/auth/*` e health levam `[AllowAnonymous]`,
  além do documento OpenAPI de dev. Rate limit por política nomeada em `RateLimitConfig` (`[EnableRateLimiting]`).
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
Cada `ApiFactory` tem a própria chave do JWT e um `ManualTimeProvider` no lugar do `TimeProvider` (`factory.Time`).
Todo `PUT` de teste leva uma `Idempotency-Key` (`WriteRequests.Put`, chave nova por chamada); sem ela o filtro responde 428.
Teste que mexe em linhas de todos os usuários (como a limpeza) usa banco próprio, sobrescrevendo `Database` da `ApiFactory`.
A base comum (`SyncEntity`, `GenericRepository`) é testada sem a API: `SyncDatabase` cria um banco com o
`SyncTestDbContext`, que soma ao `AppDbContext` a entidade só de teste `SyncProbe` (fora das migrações).
Cenários esperados em [Testes de integração](../../docs/architecture/backend.md#testes-de-integração).

## Comandos

- `pnpm dev:api` (raiz): pré-check em `scripts/dev-api`, depois `dotnet watch` em `http://localhost:8080`, Swagger
  em `/swagger`.
- `pnpm test:api` (raiz): `dotnet test` na `Vistoria.sln`.
- `dotnet build` em `apps/api`: compila e regenera `openapi.json` (ou `/gen-api`).
- Migrações (em `apps/api`, depois de `dotnet tool restore`): `dotnet ef migrations add <Nome> --project Vistoria.Api`.
  Em Development o startup aplica as pendentes (`MigrateAsync`); em produção, o `efbundle` no deploy (M5).
  `DatabaseModelTests` falha se o modelo mudou sem migração.
- Connection string `ConnectionStrings:Default` e chave do JWT `Jwt:SigningKey`: User Secrets em dev, gravadas
  pelo `pnpm db:init` (raiz), `ConnectionStrings__Default` e `Jwt__SigningKey` no container. Nunca em
  `appsettings*.json` (`SecretsTests` cobra). Sem chave válida a API não sobe (`JwtOptionsValidator`), exceto
  na geração do `openapi.json` no build (`OpenApiConfig.IsBuildTimeGeneration`).

## Quando o `dev:api` falha

Peça a mensagem exata antes de reproduzir. O pré-check já cobre os casos comuns; se passar dele, siga a ordem:

1. **Banco:** `docker ps -a --filter name=vistoria-db`. Parado → `pnpm db:up`; `docker logs --tail 50 vistoria-db`.
2. **Segredos, só os nomes:** `dotnet user-secrets list --project apps/api/Vistoria.Api | cut -d= -f1`. Nunca liste
   os valores. Faltando algum → `pnpm db:init`.
3. **Processo duplicado:** `ps -axww -o pid=,args= | grep "watch.*Vistoria.Api"`. Não suba um segundo `dotnet watch`
   ao lado do de quem está usando: dois watchers estouram o limite de inotify (128) e o processo é dele. Para
   reiniciar, Ctrl+R no terminal dele.
4. **Reproduzir:** pelo próprio `pnpm dev:api` (ou `dotnet run --launch-profile http` em `apps/api/Vistoria.Api`),
   que põe a API em Development e carrega os User Secrets. `dotnet run --environment X` não serve: no SDK, essa
   opção define variáveis (`-e CHAVE=valor`), e a API sobe sem ambiente nem segredos.
