# 0056 — Compose de produção: a migração roda num serviço de uma vez com o efbundle da imagem da API, e a API só confia no X-Forwarded-For do proxy, por IP fixo na rede do compose (#177)

- **Status:** Proposto
- **Data:** 2026-11-12

## Contexto

Pela [ADR 0011](0011-hospedagem-docker-compose-mesma-origem.md) e por [Ambientes e hospedagem](../architecture/backend.md#ambientes-e-hospedagem), a produção é um docker-compose com Caddy, `api` e `db` na mesma origem. As migrações rodam pelo `efbundle` como etapa do deploy, e não no startup como em dev. O rate limit é por IP, e atrás do Caddy o `RemoteIpAddress` é o do proxy. Para ler o IP real, a API precisa confiar no `X-Forwarded-For`, mas só no que vem do proxy. Com as listas `KnownProxies` e `KnownIPNetworks` vazias, o `ForwardedHeadersMiddleware` confia em qualquer origem. O IP de um container muda a cada `up`.

## Decisão

O `efbundle` vai na imagem da API. O serviço `migrate` usa essa imagem com o bundle de entrypoint: sobe depois do `db` saudável, aplica as migrações e sai. O `api` só sobe depois de o `migrate` terminar com sucesso. A connection string chega pela configuração do host, sem passar por argumento. A rede `edge` tem subnet fixa (`10.77.0.0/24`, fora dos pools padrão do Docker). O proxy fica em `10.77.0.10`, e a API confia só nesse IP (`ForwardedHeaders:KnownProxies`). Sem proxy configurado, a API desliga a leitura do cabeçalho.

## Consequências

Uma imagem a menos para manter. A migração falha antes de a API nova subir, e o IP do rate limit não é forjável nem pelo cliente nem com a configuração vazia. Custos aceitos:
- A imagem da API carrega o bundle, cerca de 80 MB, mesmo sem usá-lo depois do deploy.
- Uma migração que trava segura o deploy inteiro, porque não há timeout próprio: o `api` não sobe.
- A subnet e o IP fixos podem colidir com uma rede da máquina de hospedagem. Mudar o IP é mexer no compose em dois lugares.
- O banco de produção é o SQL Server Express, a edição gratuita licenciada para produção: 10 GB por banco, 1 socket ou 4 núcleos e ~1,4 GB de buffer pool. Passar disso é trocar a edição e pagar a licença. O `sa` continua sendo o usuário da API; um login SQL dedicado fica para depois.
