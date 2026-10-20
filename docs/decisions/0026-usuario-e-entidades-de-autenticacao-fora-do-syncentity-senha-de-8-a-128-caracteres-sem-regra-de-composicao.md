# 0026 — Usuário e entidades de autenticação fora do SyncEntity; senha de 8 a 128 caracteres sem regra de composição

- **Status:** Proposto
- **Data:** 2026-10-20

## Contexto

O [backend.md](../architecture/backend.md#entidade-sincronizável) dizia que toda entidade herda de `SyncEntity`, "sem exceção". `User`, `RefreshToken` e `IdempotencyRecord` nunca sincronizam: não têm dono, soft delete nem delta, e `User` guarda o hash da senha, que pelo [ADR 0013](0013-entidades-sensiveis-sem-sync.md) não pode chegar ao aparelho. O `signup` (#19) também precisava de um requisito mínimo de senha, que nenhum doc definia.

## Decisão

`SyncEntity` vale para as entidades do domínio; as de autenticação e infraestrutura (`User`, `RefreshToken`, `IdempotencyRecord`) não herdam dele e mantêm `Id` Guid v7, gerado no servidor. A senha tem de 8 a 128 caracteres, sem regra de composição e sem trim ([Autenticação](../architecture/backend.md#autenticação)).

## Consequências

Nenhuma coluna morta (`Version`, `OwnerId`, `DeletedAt`) nas tabelas de autenticação, e o que não sincroniza continua sem caminho para o aparelho. A senha segue o NIST 800-63B (comprimento, não composição), e o teto de 128 limita o custo do PBKDF2 por requisição. Custo aceito: a regra do `SyncEntity` deixa de ser absoluta e pede uma lista de exceções, que ainda não tem teste que a imponha (o `SyncEntity` chega na fase 2); e 8 caracteres é abaixo dos 15 que o NIST recomenda para senha como fator único, aceito porque o login também tem rate limit ([ADR 0004](0004-signup-aberto-com-rate-limit.md)).
