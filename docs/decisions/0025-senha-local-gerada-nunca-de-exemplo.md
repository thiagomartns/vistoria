# 0025 — Senha local gerada, nunca de exemplo

- **Status:** Aceito
- **Data:** 2026-10-20

## Contexto

O `infra/.env.example` trazia uma senha `sa` de exemplo, e o passo de setup era `cp infra/.env.example infra/.env`. Toda máquina passava a usar uma senha publicada no repositório, sem ninguém notar: aconteceu na #18, e não foi a primeira vez. Copiar a senha à mão para os User Secrets também falhava (placeholder colado; o `!` dela expandido pelo zsh). A regra "segredos fora do repositório" está em [backend.md](../architecture/backend.md#correções-obrigatórias-no-código-do-curso) e no `apps/api/CLAUDE.md`.

## Decisão

Nenhum arquivo versionado tem valor de segredo, nem de exemplo: um `.env.example` só lista nomes. A senha local é gerada aleatoriamente por `pnpm db:init`, que grava o `infra/.env` (0600) e a connection string nos User Secrets, sem imprimir a senha nem passá-la por argumento de processo. `pnpm db:init --rotate` troca a senha com `ALTER LOGIN`, sem perder o banco. O `SecretsTests` quebra o CI se um `.env.example` tiver valor ou se um compose tiver senha literal.

## Consequências

Cada máquina tem uma senha própria e ninguém digita senha. Custo aceito: o setup depende do `pnpm db:init` (Node e .NET instalados antes do primeiro `db:up`). Quem perder o `infra/.env` com o volume parado precisa recuperar a senha antiga ou recriar o banco local. A senha antiga continua no histórico do git: deixou de valer só porque foi trocada em cada máquina.
