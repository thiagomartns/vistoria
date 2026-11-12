# Imagem do proxy de produção (infra/docker-compose.prod.yml): o Caddy com o static export do web dentro.
# Context: a raiz do repositório (o workspace do pnpm e o lockfile).

FROM node:24.22.0-slim AS web
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /src
# Só o lockfile: as dependências baixam numa camada que o código não invalida.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY apps/web/ apps/web/
RUN pnpm install --offline --frozen-lockfile --filter web && pnpm --filter web build

FROM caddy:2.11.6-alpine
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /src/apps/web/out /srv
