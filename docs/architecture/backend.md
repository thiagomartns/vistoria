# Arquitetura Backend — API .NET para app local-first

## Decisão e princípios

A API evolui a estrutura do curso: controllers e camadas horizontais (Controller → Service → Repository), sem vertical slices nem Minimal APIs. O esforço de estudo vai para o que é novo de verdade (concorrência, idempotência e sync), não para uma arquitetura nova.

Este documento é a **fonte única do contrato de sincronização**: rotas, cabeçalhos, catálogo de erros e todos os prazos. O documento do front ([Arquitetura Frontend — App local-first](frontend.md)) cumpre esse contrato e não redefine nenhum status, cabeçalho ou valor.

**Por que essa escolha**

- **Orçamento de aprendizado.** Sync offline já traz cinco conceitos novos: IDs do cliente, versão otimista, idempotência, delta e soft delete. Trocar a arquitetura junto dobraria a curva sem resolver nenhum problema que o app tenha.
- **O curso continua sendo material de consulta.** Toda aula ainda se aplica; só acrescentamos camadas por cima.
- **Migrar depois é barato.** Reorganizar por feature é mover pastas, não reescrever.

**Princípios**

1. **O .NET é a autoridade.** Valida, autoriza e detecta conflito. O cliente só propõe.
2. **Toda entidade do domínio é sincronizável** e herda de `SyncEntity`. Só as de autenticação e infraestrutura (`User`, `RefreshToken`, `IdempotencyRecord`) ficam fora ([ADR 0026](../decisions/0026-usuario-e-entidades-de-autenticacao-fora-do-syncentity-senha-de-8-a-128-caracteres-sem-regra-de-composicao.md)).
3. **O contrato é o produto.** O OpenAPI 3.1 gerado alimenta o front, inclusive a lista de tipos de erro.
4. **Erro se identifica pelo `type`, nunca só pelo status.** Cada `type` tem exatamente uma reação no front.
5. **Toda escrita é idempotente e versionada:** `Idempotency-Key` sempre; `If-Match` sempre que o registro já existe.
6. **Async de ponta a ponta.**
7. **Menos bibliotecas.** O que o ASP.NET Core 10 já faz bem fica no nativo.

## Visão geral

> Diagrama: camadas da API e peças transversais (disponível na versão original do documento)

A espinha é a do curso. O que é novo fica à direita, como peças plugadas ao pipeline, e na camada de services, que passa a cuidar de versão, agregado e delta.

## Stack

A maior parte vem do curso. Entram peças nativas do ASP.NET Core para erros, OpenAPI, senha e tempo; saem as bibliotecas que não servem ao app.

| Peça | Escolha | Origem | Motivo |
| --- | --- | --- | --- |
| Runtime | .NET 10 (LTS), pacotes estáveis | Curso, atualizado | O curso usa builds RC |
| Web | ASP.NET Core com controllers | Curso | Estrutura conhecida |
| ORM / banco | EF Core 10 + SQL Server | Curso | Testcontainers já configurado |
| Migrações | EF Core Migrations | **Novo** | Substitui o Evolve 3.3.0-alpha1 |
| Mapeamento | Mapster | Curso | Já dominado |
| OpenAPI | `Microsoft.AspNetCore.OpenApi` (3.1) | **Novo** | Contrato que o front consome |
| Docs da API | Swagger UI (só `Swashbuckle.AspNetCore.SwaggerUI`) | Curso | UI familiar; lê o documento nativo |
| Validação | Data Annotations + `[ApiController]` + `SystemTextJsonValidationMetadataProvider` | Curso, ajustado | Erros com o nome JSON do campo |
| Erros | `AddProblemDetails` + `IExceptionHandler` | **Novo** | Catálogo único de erros |
| Auth | JwtBearer + refresh token em cookie | Curso, ajustado | Cookie em vez de corpo |
| Hash de senha | `PasswordHasher<User>` (PBKDF2) | **Novo** | Substitui SHA-256 sem salt |
| Rate limiting | `AddRateLimiter` | **Novo** | Protege login e refresh |
| Tempo | `TimeProvider` | **Novo** | Prazos testáveis (TTL, expiração, cursor) |
| Tarefas periódicas | `BackgroundService` | **Novo** | Limpa chaves e tombstones vencidos |
| Logs | Serilog | Curso | — |
| Testes | xUnit + Testcontainers + AwesomeAssertions | Curso, ajustado | FluentAssertions 8 exige licença paga para uso comercial |

**Sai do projeto:** o gerador do Swashbuckle (SwaggerGen), HATEOAS, formatadores XML, Evolve, `PersonQueryBuilder` e a listagem paginada com busca. A busca acontece no banco local do front (ver Decisões tomadas).

## Estrutura de pastas

Mesma organização do curso, com duas pastas novas: `Sync/` (cursor e ETag) e `Infrastructure/` (erros, idempotência, OpenAPI, limpeza). Domínio: vistoria de imóveis, com quatro entidades sincronizáveis (`Client`, `Property`, `Template`, `Inspection`).

```
Vistoria.Api/
  Controllers/V1/
    AuthController.cs            # signup, signin, refresh, signout
    ClientsController.cs         # GET, PUT
    PropertiesController.cs      # GET, PUT
    TemplatesController.cs       # GET, PUT
    InspectionsController.cs     # GET, PUT (upsert), DELETE
    SyncController.cs            # GET /sync/{entidade}
  Services/
    Impl/InspectionService.cs    # agregado, conclusão, trava, versão, delta
    Impl/ClientService.cs
    Impl/PropertyService.cs
    Impl/TemplateService.cs
    Impl/AuthService.cs          # cadastro, tokens, rotação, tolerância
  Repositories/
    IRepository.cs               # genérico, async, sobre SyncEntity
    Impl/GenericRepository.cs
    Impl/InspectionRepository.cs # Include de ambientes e itens, delta
  Model/
    Base/SyncEntity.cs
    Client.cs
    Property.cs
    Template.cs                  # ambientes e itens em JSON
    Inspection.cs
    Room.cs
    InspectionItem.cs
    User.cs
    RefreshToken.cs
    IdempotencyRecord.cs
    Context/AppDbContext.cs
    Configurations/              # IEntityTypeConfiguration por entidade
  Data/DTO/V1/                   # um DTO por entidade + SyncPageDto + AuthDtos
  Sync/
    SyncCursor.cs                # { version, issuedAt } ↔ base64
    ETagHelper.cs                # rowversion ↔ ETag
  Infrastructure/
    Errors/ProblemTypes.cs       # catálogo de types (fonte do enum ProblemType)
    Errors/AppExceptions.cs      # uma exceção por type
    Errors/GlobalExceptionHandler.cs
    Idempotency/IdempotencyFilter.cs
    OpenApi/ContractTransformers.cs
    Background/CleanupService.cs # chaves > 7 dias, tombstones > 90 dias
  Configurations/                # extensões Add*/Use* (padrão do curso)
  Migrations/
  Program.cs
Vistoria.Api.Tests/
  Integration/                   # Testcontainers + WebApplicationFactory
  Unit/
```

## Entidade sincronizável

Toda entidade do domínio herda de `SyncEntity`, que substitui o `BaseEntity` do curso (só um `long` identity) e carrega o que o sync precisa. `User`, `RefreshToken` e `IdempotencyRecord` não sincronizam e não herdam dele: não têm dono, soft delete nem delta, e o hash da senha nunca vai ao aparelho ([ADR 0013](../decisions/0013-entidades-sensiveis-sem-sync.md)). O `Id` de `User` também é UUID v7, gerado no servidor no `signup`.

```csharp
public abstract class SyncEntity
{
    public Guid Id { get; set; }                  // gerado no cliente (UUID v7)
    public byte[] Version { get; set; }           // rowversion do SQL Server
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; } // soft delete
    public Guid OwnerId { get; set; }             // escopo de quem vê
}
```

| Campo | Para que serve no sync | Configuração EF |
| --- | --- | --- |
| `Id` | Cliente cria registros offline e os referencia antes do servidor saber deles | `ValueGeneratedNever()` |
| `Version` | Detectar conflito (ETag) e servir de cursor do delta | `.IsRowVersion()` |
| `UpdatedAt` | Ordenar e exibir "última alteração" | Preenchido em `SaveChangesAsync` |
| `DeletedAt` | Cliente descobre que o registro sumiu | Filtro global `DeletedAt == null` |
| `OwnerId` | Delta só devolve o que o usuário pode ver | Índice (`OwnerId`, `Version`) |

**Regra do agregado (Inspection → Room → InspectionItem)**

- `Inspection` é a raiz. Ambientes e itens só são escritos pelo `PUT` da vistoria, nunca por endpoint próprio. Campos e limites de cada entidade estão no [Modelo de domínio](../vision.md#modelo-de-domínio) do documento [Visão do Projeto](../vision.md).
- A versão do agregado é a da raiz. Toda mudança em ambiente ou item atualiza `Inspection.UpdatedAt`, o que força a linha da raiz a mudar e o rowversion a subir. ETag e delta só olham a raiz.
- No `PUT`, `rooms` (e `items` dentro de cada ambiente) é a lista completa. Id novo é criado; existente que não veio é marcado com `DeletedAt`.
- `Room` e `InspectionItem` não têm `version` própria.
- **Conclusão:** o `PUT` com `status: completed` só é aceito se houver ao menos um ambiente, ao menos um item por ambiente e `condition` em todos os itens. O servidor grava `CompletedAt`. Depois disso, qualquer `PUT` ou `DELETE` responde 409 `locked`.
- **Saída:** `referenceInspectionId`, quando presente, precisa apontar para uma entrada concluída do mesmo imóvel e do mesmo dono.
- `Template` guarda ambientes e itens como JSON numa coluna só: é um molde, nunca consultado por item.

**Regras gerais**

- `CreatedAt` e `UpdatedAt` saem do `TimeProvider` num override de `SaveChangesAsync`, nunca do cliente.
- Exclusão é sempre `DeletedAt = now`: o `SaveChangesAsync` transforma o `Remove` de uma `SyncEntity` em update, então a linha muda de versão. O filtro global nomeado `SoftDelete` esconde o registro; o delta usa `IgnoreQueryFilters()` para devolver o tombstone.
- Tombstones com mais de 90 dias são apagados fisicamente pelo `CleanupService`.
- UUID v7 é ordenável no tempo no cliente e em logs (`Guid.CreateVersion7()` no .NET). O SQL Server ordena `uniqueidentifier` pelos últimos bytes, então lá dentro ele não é sequencial; no volume de estudo isso não pesa. Se pesar: PK *nonclustered* em `Id` + índice clusterizado em `CreatedAt`.

## Contrato da API

Rotas no plural com a versão no prefixo (`/api/v1/...`). `operationId` explícito em camelCase via `[EndpointName]`. JSON em camelCase, datas em ISO 8601 com offset, enums como string. Todo erro é `ProblemDetails` com um `type` do catálogo abaixo.

### Endpoints

| Método e rota | operationId | Sucesso | Erros possíveis |
| --- | --- | --- | --- |
| `GET /api/v1/inspections/{id}` | `getInspection` | 200 + `ETag` | 401, 404 |
| `PUT /api/v1/inspections/{id}` | `upsertInspection` | 201 (criou) ou 200 (atualizou), + `ETag` | 400, 401, 403, 409, 410, 412, 422, 428, 429 |
| `DELETE /api/v1/inspections/{id}` | `deleteInspection` | 204, inclusive se já excluída ou inexistente | 401, 403, 409, 412, 422, 428, 429 |
| `GET /api/v1/sync/inspections?cursor=&limit=` | `syncInspections` | 200 `SyncPageDto<InspectionDto>` | 400, 401, 410 |
| `GET`, `PUT` e sync de `clients`, `properties` e `templates` | `getClient`, `upsertClient`, `syncClients` e equivalentes | Iguais aos de vistoria | Iguais, sem `DELETE` na V1 |
| `POST /api/v1/auth/signup` | `signUp` | 201 `{ accessToken, expiresAt, user: { id, name } }` + cookie | 400 (inclusive e-mail já usado, em `errors.email`), 429 |
| `POST /api/v1/auth/signin` | `signIn` | 200 `{ accessToken, expiresAt, user: { id, name } }` + cookie | 400, 401 (`invalid-credentials`), 429 |
| `POST /api/v1/auth/refresh` | `refreshToken` | 200 `{ accessToken, expiresAt }` + cookie novo (exceto na tolerância) | 401, 429 |
| `POST /api/v1/auth/signout` | `signOut` | 204, cookie apagado | — |

**Por que `PUT` com ID do cliente em vez de `POST`.** O cliente já sabe o ID, então criar e atualizar viram a mesma operação (upsert), e reenviar é naturalmente seguro.

**Id só na rota; todo `PUT` regrava** ([ADR 0028](../decisions/0028-id-do-registro-so-na-rota-e-put-sempre-regrava.md)). O DTO de entrada não tem `id` nem `version`: o id vem da rota, a versão-base do `If-Match`, e um `id` no corpo é ignorado como qualquer campo desconhecido (na vistoria, só o da raiz; `rooms[].id` e `items[].id` vão no corpo). Um `PUT` aceito sempre sobe a versão, mesmo com os valores iguais aos gravados.

### Cabeçalhos

| Cabeçalho | Onde | Regra |
| --- | --- | --- |
| `If-Match` | `PUT` e `DELETE` de registro que existe | ETag da versão-base. Ausente quando o registro existe → 428. Na criação (id inexistente) é omitido e ignorado. |
| `Idempotency-Key` | Todo `PUT` e `DELETE` | UUID v7. Uma chave por corpo: o mesmo corpo reenviado usa a mesma chave; um corpo novo (por exemplo, depois de um merge) usa chave nova. Ausente → 428. |
| `ETag` | Respostas 200/201 de `GET` e `PUT` | `"<version em base64>"`, forte. O DTO repete o valor sem aspas em `version`. |
| `Retry-After` | 429 e 409 `idempotency-in-progress` | Segundos |
| `Authorization` | Todas as rotas, exceto `/auth/*` | `Bearer <accessToken>` |

**Por que 428 para `Idempotency-Key` ausente.** O rascunho da IETF para o cabeçalho pede 400. Mantemos 428 de propósito: é um cabeçalho exigido antes de processar, como o `If-Match`, e o front decide pelo `type` (`precondition-required`, com `missingHeader`), não pelo status. Trocar para 400 não mudaria nenhuma reação.

### Catálogo de erros

Todo erro traz `type`, `title`, `status`, `detail` e `traceId`. O front decide **pelo `type`**: 409 e 412 compartilham `version-conflict` de propósito, porque a reação é a mesma; o status só diz onde o conflito foi detectado.

O `type` é uma URN: `urn:vistoria:problem:` seguido do slug da tabela (por exemplo, `urn:vistoria:problem:not-found`), conforme o [ADR 0024](../decisions/0024-type-de-erro-como-urn.md). A tabela e o resto dos docs usam só o slug.

| Status | `type` | Quando | Extensões | Reação do front |
| --- | --- | --- | --- | --- |
| 400 | `validation` | Corpo inválido, inclusive conclusão incompleta e e-mail já cadastrado | `errors` por campo | Volta ao rascunho (ou ao formulário) com os erros |
| 400 | `invalid-cursor` | Cursor ilegível | — | Resync completo da entidade |
| 401 | `unauthorized` | Access token ausente, inválido ou expirado | — | Pausa a fila, refresh em aba única, retoma |
| 401 | `invalid-credentials` | E-mail ou senha errados no `signin`; a mesma resposta para os dois ([ADR 0027](../decisions/0027-credencial-invalida-com-type-proprio-invalid-credentials-complementando-o-adr-0018.md)) | — | Mostra "E-mail ou senha incorretos." no formulário; não tenta refresh |
| 403 | `forbidden` | Registro de outro dono | — | Descarta a transação, reverte e avisa |
| 404 | `not-found` | `GET` de id inexistente | — | Remove do banco local |
| 405, 406, 415 | `unsupported-request` | Método, `Accept` ou `Content-Type` não suportado pela rota | — | Bug: registra e descarta |
| 409 | `version-conflict` | Corrida detectada no `SaveChanges` | `current` | Merge |
| 409 | `idempotency-in-progress` | Mesma chave ainda em processamento | — | Retry após `Retry-After`, mesma chave |
| 409 | `locked` | `PUT` ou `DELETE` em vistoria concluída | `current` | Descarta a transação, adota `current` e avisa que foi concluída em outro aparelho |
| 410 | `deleted` | `PUT` em registro excluído | `deletedAt` | Usuário escolhe: recriar com novo id ou descartar |
| 410 | `cursor-expired` | Cursor mais velho que a retenção de tombstones | — | Resync completo da entidade |
| 412 | `version-conflict` | `If-Match` diferente da versão atual | `current` | Merge |
| 422 | `idempotency-key-reused` | Mesma chave com corpo diferente | — | Bug: registra e descarta |
| 428 | `precondition-required` | Faltou `If-Match` ou `Idempotency-Key` | `missingHeader` | Bug: registra e descarta |
| 429 | `rate-limited` | Limite de taxa | — | Retry após `Retry-After` |
| 5xx | `internal` | Falha inesperada | — | Retry com backoff, mesma chave |

### Erros por campo

- As chaves de `errors` são o caminho JSON em camelCase relativo ao corpo, com índice da posição enviada: `rooms[2].items[4].condition`. O front converte para o nome de campo do react-hook-form (`rooms.2.items.4.condition`) numa função única ([ADR 0023](../decisions/0023-formularios-com-react-hook-form.md)).
- Para isso: `options.ModelMetadataDetailsProviders.Add(new SystemTextJsonValidationMetadataProvider())` nos controllers. O model state inválido vira `ValidationException` (`ModelStateErrors`), então sai no mesmo formato de uma regra do service.
- Erros de desserialização (tipo errado, JSON malformado) perdem o prefixo `$.` (`$` sozinho vira `""`, erro do corpo inteiro) e trocam a mensagem do System.Text.Json, que cita tipo .NET, linha e byte, por "Valor ausente ou com formato inválido.". O erro "campo obrigatório" do próprio parâmetro de corpo é descartado.
- DTO de entrada usa propriedades `{ get; init; }`, sem record posicional nem `required` do C#: o provider não atua nos parâmetros do construtor, e o `required` falha na desserialização, antes da validação.

### OpenAPI

- `AddOpenApi()` + `MapOpenApi()` (documento em `/openapi/v1.json`) + `UseSwaggerUI(o => o.SwaggerEndpoint("/openapi/v1.json", "v1"))`.
- Um *operation transformer* (`Infrastructure/OpenApi/ContractTransformers.cs`) documenta `If-Match` e `Idempotency-Key` em todo `PUT` e `DELETE`, e as respostas de erro de cada endpoint em `application/problem+json`, com `Retry-After` em 429 e 409.
- Os erros de cada action são declarados com `[ProblemResponses(...)]`, com os status da coluna "Erros possíveis" da tabela de Endpoints. No controller vale para todas as actions; controller e action se somam.
- `If-Match` sai com `required: false` e `Idempotency-Key` com `required: true`. `If-Match` é exigido só quando o registro existe (428 se faltar), e marcá-lo obrigatório faria o client gerado exigi-lo também no upsert que cria.
- Um *document transformer* publica o schema `ProblemType`: um enum com todos os `type` do catálogo, lido de `ProblemTypes.cs`. O front recebe isso como union TypeScript. Um `type` novo no backend quebra o build do front até ganhar uma reação. O mesmo transformer publica `ProblemDetails`, com `type` apontando para `ProblemType` e as extensões do catálogo como campos opcionais (`current` sem schema fixo: é o DTO da rota).

## Parâmetros compartilhados

Todo prazo e limite do sistema está aqui, e só aqui. O front lê esta tabela; mudar um valor é mudar uma linha.

| Parâmetro | Valor | Quem aplica |
| --- | --- | --- |
| Access token | 15 min | .NET |
| Refresh token | 7 dias, renovados a cada uso; teto absoluto de 30 dias desde o login | .NET |
| Tolerância de rotação do refresh | 30 s | .NET |
| Janela de uso offline | 72 h desde o último refresh bem-sucedido | Front |
| Validade da `Idempotency-Key` | 7 dias | .NET |
| Retenção de tombstones | 90 dias | .NET |
| Página do delta | 500 por padrão, 1000 no máximo | .NET |
| Pull periódico | A cada 60 s com o app visível | Front |
| Backoff de retry | 1 s, dobrando até 5 min, com jitter | Front |
| Pendência "travada" | 24 h falhando sem sucesso | Front |
| Envio em paralelo | Até 4 registros; em ordem dentro do mesmo registro | Front |
| Rate limit de `signup` e `signin` | 5 por minuto por IP, cada | .NET |
| Rate limit de `refresh` | 30 por minuto por IP | .NET |

**Como os prazos se encaixam.** A chave de idempotência vale 7 dias, o mesmo que o refresh token. Um aparelho offline por mais tempo que isso precisa entrar de novo antes de enviar qualquer coisa. O caso que sobra (chave vencida reenviada) responde 412 com `current` igual ao corpo enviado, e o front trata isso como sucesso (ver Sync).

## Sync

O servidor faz duas coisas pelo front local-first. Aceita escritas que provam sobre qual versão foram feitas. E entrega, por cursor, tudo o que mudou desde a última vez.

### Escrita

> Diagrama: tratamento de um PUT no InspectionService · 7 decisões (disponível na versão original do documento)

A ordem importa: idempotência primeiro (um retry nunca reexecuta nada), depois exclusão e trava de conclusão, depois versão, e validação por último. A checagem no `SaveChanges` cobre a janela entre ler e gravar, quando duas requisições correm juntas. O `DELETE` segue o mesmo caminho, com uma diferença: registro inexistente ou já excluído responde 204 direto. Os outros recursos (`clients`, `properties`, `templates`) usam o mesmo fluxo, sem a trava de conclusão.

**Idempotência**

- Tabela `idempotency_keys`: `Key`, `UserId`, `RequestHash` (SHA-256 de método + rota + corpo), `State` (`processing` ou `done`), `StatusCode`, `ResponseBody`, `CreatedAt`. Índice único em (`UserId`, `Key`).
- O filtro insere a chave como `processing` antes da action. Chave `done` com o mesmo hash → devolve a resposta gravada. Chave `processing` → 409 `idempotency-in-progress`. Hash diferente → 422 `idempotency-key-reused`.
- Respostas finais (2xx e 4xx, exceto 401 e 429) são gravadas. Em 5xx a linha é apagada, para o retry executar de novo.
- O `CleanupService` roda a cada hora e apaga chaves com mais de 7 dias e tombstones com mais de 90.

**Escrita repetida depois que a chave venceu.** O servidor reexecuta e responde 412, porque a primeira execução já mudou a versão. O `current` devolvido é igual ao corpo enviado. O servidor não tenta detectar isso; o front compara e trata como sucesso.

### Leitura por delta

Cada entidade tem seu endpoint de delta (`/api/v1/sync/inspections`, `/clients`, `/properties`, `/templates`), todos com o mesmo formato: um `SyncPageDto` com `items` (agregados completos), `deletedIds`, `nextCursor` e `hasMore`. O cliente repete a chamada enquanto `hasMore` for verdadeiro, com um cursor por entidade.

- **Cursor:** base64 opaco de `{ version, issuedAt }`, onde `version` é o rowversion da última raiz enviada. O rowversion cresce a cada escrita no banco inteiro, então "tudo com `Version` maior que o cursor" é exatamente "tudo o que mudou desde então".
- **Teto `MIN_ACTIVE_ROWVERSION()`.** Uma transação ainda aberta pode gravar uma versão menor que outra já confirmada. Sem esse teto, o delta pularia essa linha para sempre.
- **Consulta:** `WHERE OwnerId = @user AND Version > @cursor AND Version < MIN_ACTIVE_ROWVERSION() ORDER BY Version`, buscando `limit + 1` linhas para saber se há mais. Como o EF não compara `byte[]` com `>`, ela roda via `FromSql($"...")`, que parametriza os valores interpolados (ao contrário do `FromSqlRaw` com string montada do curso).
- **Tombstones:** a consulta usa `IgnoreQueryFilters()`. Raízes com `DeletedAt` vão para `deletedIds`; as outras, para `items`. Ambientes e itens excluídos de uma vistoria viva simplesmente não aparecem nela.
- **Primeiro sync** (cursor vazio): devolve só registros vivos.
- **Cursor vencido:** `issuedAt` mais velho que a retenção de tombstones (90 dias) → 410 `cursor-expired`. O cliente pode ter perdido exclusões já purgadas, então refaz o sync do zero. Cursor ilegível → 400 `invalid-cursor`, mesma reação.

## Autenticação

O JWT do curso continua, com quatro mudanças. O refresh token sai do corpo e vai para cookie. Ele é rotacionado a cada uso. O banco guarda só o hash dele. E existe uma tolerância curta para várias abas que pedem refresh ao mesmo tempo.

| Peça | Como fica |
| --- | --- |
| Access token | JWT devolvido no corpo; o front guarda só em memória. Prazo em Parâmetros. |
| Refresh token | 32 bytes aleatórios em cookie `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth` |
| Armazenamento | Tabela `refresh_tokens`: hash SHA-256, `UserId`, `FamilyId`, `ExpiresAt`, `RevokedAt`, `ReplacedAt` |
| Rotação | Cada `refresh` marca o token usado como substituído e emite outro, com o mesmo `FamilyId` |
| Tolerância | Token substituído há menos de 30 s: aceita, devolve só um access token novo e **não** envia cookie (o navegador já recebeu o sucessor) |
| Reuso | Token substituído há mais de 30 s, ou revogado: revoga a família inteira e responde 401 |
| Teto | Família com mais de 30 dias desde o login não renova; exige `signin` |
| Senha | `PasswordHasher<User>` (PBKDF2 com salt). De 8 a 128 caracteres, sem regra de composição nem trim; o teto limita o custo do hash por requisição |
| E-mail | Único sem diferenciar maiúsculas: gravado com trim e em minúsculas, com índice único. Já usado → 400 `validation` em `errors.email` |
| Validação do access token | JwtBearer: emissor, audiência, chave e só HS256. O prazo é conferido pelo `TimeProvider`, sem tolerância de relógio (quem emite e quem valida é a mesma API). Falha → 401 `unauthorized` com `WWW-Authenticate: Bearer` |
| Rotas | Exigem access token por padrão (fallback policy). Só `/auth/*`, health e o documento OpenAPI levam `[AllowAnonymous]`; sem token, até rota inexistente responde 401 |
| Credencial inválida | Senha errada e e-mail inexistente → o mesmo 401 `invalid-credentials`. O e-mail inexistente também roda o PBKDF2, contra um hash fixo, para o tempo não revelar quais e-mails têm conta |
| Re-hash | Login com hash em formato ou custo antigo (`SuccessRehashNeeded`) regrava o hash no atual |
| Chave do JWT | HS256, base64 de pelo menos 32 bytes. User Secrets em dev (`Jwt:SigningKey`, gravada pelo `pnpm db:init`), `Jwt__SigningKey` em produção; nunca no `appsettings.json`. Sem chave válida a API não sobe |
| `signout` | Revoga a família e apaga o cookie |

**Por que a tolerância existe.** Num PWA com várias abas, duas podem pedir refresh com o mesmo cookie quase juntas. Sem a tolerância, a segunda seria lida como roubo e deslogaria o usuário. O front já coordena o refresh numa aba só; a tolerância cobre a corrida que sobrar.

**Por que SHA-256 aqui é aceitável e na senha não.** O refresh token já tem 256 bits aleatórios, então não existe dicionário para atacar. Senha humana tem pouca entropia e precisa de hash lento com salt.

**O `user.id` do `signin`** é o que o front usa para separar o banco local por usuário.

## Ambientes e hospedagem

Em produção, front e API ficam na **mesma origem**, atrás de um proxy. Isso elimina CORS e qualquer dúvida sobre o cookie. Só o desenvolvimento usa origens diferentes.

|  | Desenvolvimento | Produção |
| --- | --- | --- |
| Front | `next dev` em `localhost:3000` | Arquivos do static export servidos pelo Caddy |
| API | `dotnet watch` em `localhost:8080` | Container `api` atrás do Caddy em `/api/*` |
| Banco | SQL Server em container local | Container `db` com volume persistente |
| CORS | Origem `http://localhost:3000` com `AllowCredentials()`, expondo `ETag` e `Retry-After` | Desligado (mesma origem) |
| Cookie | `Secure` funciona em `localhost`; portas diferentes contam como mesmo site | Mesma origem |
| Migrações | `Database.MigrateAsync()` no startup | Bundle `efbundle` executado como etapa do deploy |

**docker-compose de produção:** `proxy` (Caddy, com TLS automático), `api` e `db`. O Caddy encaminha `/api/*` para `api:8080` e serve o resto como arquivos estáticos com `try_files {path} {path}.html {path}/index.html`. As rotas do front não têm segmentos dinâmicos (o id vai na query string), então não há reescrita por rota.

**Ordem do pipeline:** `UseExceptionHandler` → `UseCors` (só em dev) → `UseRateLimiter` → `UseAuthentication` → `UseAuthorization` → `MapControllers`. Com o CORS antes, o preflight não gasta o rate limit; com o rate limit antes da autenticação, força bruta é cortada antes de qualquer PBKDF2.

**IP do rate limit atrás do proxy.** O limite é por `RemoteIpAddress`. Atrás do Caddy esse é o IP do proxy, então a produção precisa do `ForwardedHeaders` (confiando só no proxy) para ler o IP real; entra com a hospedagem (M5).

## Correções obrigatórias no código do curso

As duas primeiras são falhas de segurança. Nenhum código herdado da aula `30_DockerizingOurApp` vai para produção sem elas.

- [ ] **SQL injection.** O `PersonQueryBuilder` interpola `name` direto no SQL (`LIKE '%{name}%'`) e executa com `FromSqlRaw`. O arquivo sai; qualquer consulta com valor externo usa LINQ ou `FromSql($"...")` interpolado, que parametriza.
- [ ] **Hash de senha.** `Sha256PasswordHasher` usa SHA-256 sem salt. Trocar por `PasswordHasher<User>`; usuários antigos são re-hasheados no próximo login bem-sucedido.
- [ ] **Segredos fora do repositório.** A chave do JWT e a senha `sa` estão no `appsettings.json`. Mover para User Secrets em dev e variáveis de ambiente no container.
- [ ] **Update cego.** `GenericRepository.Update` usa `SetValues` sem checar versão. Passa a exigir `Version` como valor original e deixa o EF lançar `DbUpdateConcurrencyException`.
- [ ] **I/O síncrono.** `ToList` e `SaveChanges` viram `ToListAsync` e `SaveChangesAsync`, com `CancellationToken`.
- [ ] **Erros em string.** `BadRequest("...")`, e `NotFound()` quando o create falha, viram exceções tipadas → `GlobalExceptionHandler` → catálogo de erros.
- [ ] **Ordem do pipeline.** `UseCors` roda depois de `UseAuthorization`. Ordem correta em Ambientes e hospedagem.
- [ ] **Pacotes em pré-release.** JwtBearer e EF Core em RC, Evolve em alpha, Serilog em `-dev`. Fixar versões estáveis.
- [ ] **`DateTime.Now` no token.** `TokenGenerator` usa horário local. Usar `TimeProvider`.
- [ ] **Remover o que não serve ao app:** HATEOAS, formatadores XML, o SwaggerGen do Swashbuckle (fica só o SwaggerUI), `TestLogsController`, o middleware manual de bloqueio de origem e o Portainer do `docker-compose`.

## Testes de integração

O setup do curso (`WebApplicationFactory` + Testcontainers com SQL Server real) é mantido. Concorrência e rowversion não existem em banco em memória. Prazos são testados com um `TimeProvider` falso. Cada teste cria os próprios dados com IDs novos, então o `PriorityOrderer` do curso não é necessário.

| Área | Cenário | Esperado |
| --- | --- | --- |
| Upsert | `PUT` de vistoria nova sem `If-Match` | 201 + `ETag` |
| Upsert | `PUT` com `If-Match` correto | 200 + `ETag` novo |
| Upsert | Dois `PUT` simultâneos criando o mesmo id, com chaves de idempotência diferentes | Um 201; o outro 409 `version-conflict` com `current`, nunca 500 |
| Versão | `PUT` com `If-Match` antigo | 412 `version-conflict` com `current` |
| Versão | Dois `PUT` simultâneos com a mesma versão | Um 200, outro 409 `version-conflict` |
| Versão | `PUT` em registro existente sem `If-Match` | 428 `precondition-required` |
| Exclusão | `PUT` em vistoria excluída | 410 `deleted` |
| Exclusão | `DELETE` de id inexistente ou já excluído | 204 |
| Agregado | Mudar só um item de um ambiente | `ETag` da vistoria muda |
| Agregado | Ambiente ou item omitido no `PUT` | Marcado com `DeletedAt`; some da resposta |
| Conclusão | Concluir com item sem condição | 400 com a chave `rooms[0].items[1].condition` |
| Conclusão | `PUT` ou `DELETE` em vistoria concluída | 409 `locked` com `current` |
| Saída | Referência a entrada não concluída ou de outro imóvel | 400 em `referenceInspectionId` |
| Idempotência | Sem `Idempotency-Key` | 428 `precondition-required` |
| Idempotência | Mesma chave duas vezes | Mesma resposta; um único efeito no banco |
| Idempotência | Mesma chave em paralelo | Um processa; o outro recebe 409 `idempotency-in-progress` |
| Idempotência | Mesma chave em paralelo em duas instâncias da API (dois hosts, mesmo banco) | Um processa; o outro recebe 409 `idempotency-in-progress` |
| Idempotência | Mesma chave, corpo diferente | 422 `idempotency-key-reused` |
| Idempotência | Chave vencida reenviada | 412 com `current` igual ao corpo |
| Limpeza | `CleanupService` rodando em duas instâncias ao mesmo tempo | Sem erro; cada registro vencido é removido uma vez |
| Delta | Paginação com `limit` pequeno | Nenhum registro pulado ou repetido |
| Delta | Transação aberta durante a leitura | Linha aparece na página seguinte, não é pulada |
| Delta | `DELETE` e depois delta | Id em `deletedIds` |
| Delta | Cursor com `issuedAt` de 91 dias | 410 `cursor-expired` |
| Delta | Registros de outro usuário | Nunca aparecem |
| Auth | `signup` com e-mail já usado | 400 com `errors.email` |
| Auth | `signin` com senha errada e com e-mail inexistente | O mesmo 401 `invalid-credentials` |
| Auth | `signin` com hash em formato antigo | 200 e hash regravado no formato atual |
| Auth | Rota protegida sem token, com token de outra chave ou vencido pelo `TimeProvider` falso | 401 `unauthorized` |
| Auth | 6ª chamada de `signin` (ou `signup`) no mesmo minuto e IP | 429 `rate-limited` com `Retry-After`; o outro endpoint e outro IP seguem livres |
| Auth | Preflight de `localhost:3000` | Permitido com credenciais só em Development |
| Auth | Refresh reutilizado em menos de 30 s | 200 sem `Set-Cookie` |
| Auth | Refresh reutilizado depois de 30 s | 401 e família revogada |
| Auth | Família com mais de 30 dias | 401 |

## Roteiro de estudo

Seis fases, cada uma com um conceito novo e um teste que prova que ele funciona. A tabela no fim diz de quais fases cada spike do front depende.

1. **Saneamento.** Correções obrigatórias, OpenAPI nativo + Swagger UI, catálogo de erros com `ProblemType` publicado, `signup` e `signin` básicos, tudo async.
   - Aprende: pipeline do ASP.NET Core, OpenAPI 3.1, tratamento centralizado de erro.
   - Pronto quando: o front gera tipos e a union `ProblemType` a partir de `openapi.json`.
2. **Entidades e agregado.** `SyncEntity`; `Client`, `Property`, `Template`; `Inspection` → `Room` → `InspectionItem`; migrações; filtro de soft delete; regra de versão da raiz.
   - Aprende: rowversion, query filters, configuração fluente do EF, agregado com dois níveis de filhos.
   - Pronto quando: mudar um item muda o `ETag` da vistoria.
   - Várias instâncias: filtro de dono (`OwnerId`) e de soft delete como filtros globais nomeados do EF Core 10, para nenhuma query esquecer o escopo.
3. **Upsert com ID do cliente.** `PUT` criando ou atualizando; `DELETE` idempotente; 410 `deleted`; conclusão e 409 `locked`.
   - Aprende: por que ID no cliente simplifica o offline; regras de negócio no agregado.
   - Pronto quando: o mesmo `PUT` repetido não duplica e uma vistoria concluída não muda mais.
4. **Concorrência otimista.** `ETag`, `If-Match`, 412/409 `version-conflict` com `current`, 428.
   - Aprende: o problema do "último a salvar vence" e como o HTTP resolve.
   - Pronto quando: o teste dos dois `PUT` simultâneos passa.
5. **Idempotência.** Filtro, tabela, 409 `idempotency-in-progress`, 422, `CleanupService`.
   - Aprende: por que retry de rede exige idempotência explícita.
   - Pronto quando: os testes de idempotência passam.
   - Várias instâncias: `idempotency-in-progress` é uma linha no banco com constraint única, nunca um lock em memória; o `CleanupService` pode rodar em mais de uma instância (exclusão idempotente ou trava).
6. **Delta, auth final e produção.** Endpoints de sync com cursor e teto; refresh em cookie com rotação e tolerância; docker-compose com Caddy.
   - Aprende: cursores, tombstones, sessão segura em SPA, proxy reverso.
   - Pronto quando: o front abre offline, edita, volta online e converge com o servidor.
   - Várias instâncias: a página do delta é limitada por `MIN_ACTIVE_ROWVERSION()`, não pelo maior rowversion lido, para uma transação sem commit não ser pulada. O `AddRateLimiter` conta por instância, o que é aceitável enquanto a hospedagem é uma instância só ([ADR 0011](../decisions/0011-hospedagem-docker-compose-mesma-origem.md)).

| Spike do front | Depende das fases | Por quê |
| --- | --- | --- |
| 1 — Outbox | 1 a 5 | Envia `PUT` com `If-Match` e `Idempotency-Key` e reenvia após reload |
| 2 — Volume | 6 | Precisa do delta para carregar 10 mil registros |
| 3 — Conflito | 1 a 4 | Precisa de 412/409 com `current` |
| 4 — Shell | 6 (só o teste de duas abas) | O resto é só front; duas abas renovando juntas exercitam a tolerância de rotação |

## Decisões tomadas

Nenhuma questão técnica fica em aberto. As decisões abaixo valem para os dois documentos; mudar qualquer uma é mudar esta tabela primeiro.

| Tema | Decisão | Motivo |
| --- | --- | --- |
| Domínio | Vistoria de imóveis para locação: `Client`, `Property`, `Template`, `Inspection` → `Room` → `InspectionItem` | Offline estrutural e formulário profundo por natureza; detalhes no documento [Visão do Projeto](../vision.md) |
| Fotos | Fora da V1; entram na V2 | Sincronizar arquivos offline é um tema inteiro; o modelo já reserva o lugar |
| Quem edita | Um vistoriador, vários aparelhos; escopo por `OwnerId` | Equipes e portal da imobiliária ficam fora |
| Cadastro de usuário | `signup` aberto com rate limit | Sem convite nem aprovação na V1 |
| Vistoria concluída | Imutável (409 `locked`) | É o que dá valor de prova ao laudo |
| Laudo | Página imprimível no front, PDF pelo navegador | Funciona offline; sem geração de PDF no servidor |
| Busca e listagem | Só no banco local do front | A API não expõe listagem paginada |
| Exclusão | Só de vistoria em andamento (soft delete); tombstones por 90 dias | Cliente, imóvel e roteiro não são excluídos na V1 |
| Banco | SQL Server | Já no curso e no Testcontainers |
| Renderização do front | Static export, sem SSR nem páginas públicas | Sem servidor Next, sem superfície de Server Components |
| Hospedagem | docker-compose: Caddy + `api` + `db`, mesma origem | Elimina CORS e problemas de cookie em produção |
| Sync engine dedicado (PowerSync) | Fora do escopo | O spike 2 mede se o delta via REST basta |
| Entidades sensíveis | Não têm endpoint de sync | O que não sincroniza nunca chega ao aparelho |
