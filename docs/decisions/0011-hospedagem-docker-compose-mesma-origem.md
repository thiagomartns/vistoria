# 0011 — Hospedagem: docker-compose na mesma origem

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

Front e API em origens diferentes trariam CORS e problemas de cookie em produção.

## Decisão

docker-compose com Caddy (TLS automático) + `api` + `db`; o Caddy serve o static export e encaminha `/api/*`.

## Consequências

Sem CORS e com cookie simples em produção. Custo aceito: um servidor único, sem alta disponibilidade, com TLS e backup operados por nós; em dev as origens continuam diferentes e o CORS existe só lá.
