# 0069 — Imagens em tag exata, escaneadas pelo Trivy e publicadas no GHCR pela tag do commit depois de todo o CI (#194, #195)

- **Status:** Proposto
- **Data:** 2026-11-26

## Contexto

Pela [ADR 0056](0056-compose-de-producao-a-migracao-roda-num-servico-de-uma-vez-com-o-efbundle-da-imagem-da-api-e-a-api-so-confia-no-x-forwarded-for-do-proxy-por-ip-fixo-na-rede-do-compose-177.md), o compose de produção construía as imagens no próprio servidor (`up --build`). Duas máquinas podiam montar imagens diferentes do mesmo commit. O SQL Server usava a `2022-latest`, que muda sozinha. Nenhum check olhava as vulnerabilidades das imagens, e o Dependabot não cobria nenhuma delas ([Ambientes e hospedagem](../architecture/backend.md#ambientes-e-hospedagem)).

## Decisão

- **Tag exata em toda imagem de terceiros**: Dockerfiles, composes e workflows, cobrado pelo `ImageTagTests`. O Dependabot sobe as imagens dos Dockerfiles e dos composes toda semana. Duas exceções sobem à mão:
  - a major do `sdk`/`aspnet`/`node`, que acompanha a do runtime;
  - a CU do SQL Server. O Dependabot lê `2022-CU28-ubuntu-22.04` como a versão 2022 com o sufixo `-CU28-…`, e a CU seguinte muda o sufixo.
- **Scan pelo Trivy** nas imagens da API e do proxy, no job `prod` e de novo no `publish`. Quebra em HIGH/CRITICAL que já tem correção. Uma exceção vai para o `.trivyignore` da imagem, com o porquê e uma data de validade.
- **Publicação no GHCR**: as duas imagens com a tag do commit e a `main`, pelo job `publish` do `ci.yml`. Esse job roda só num push na `main`, depois de todos os outros jobs, e é o único com `packages: write`. O build vem do cache do Actions que o `prod` do mesmo commit gravou, então as camadas publicadas são as que passaram pelos roteiros.
- **O compose sobe pela tag**: `IMAGE_TAG=<sha> … up --no-build`. Sem `IMAGE_TAG`, a tag é `local`, a do `pnpm prod:up`. O job `prod` já sobe por `IMAGE_TAG` e `--no-build`.
- **Pacotes privados**: o servidor entra no GHCR com um token `read:packages` guardado fora do repositório ([ADR 0025](0025-senha-local-gerada-nunca-de-exemplo.md)). O servidor e esse token são da #50.

## Consequências

O que sobe no servidor é o que o CI testou e escaneou, e o servidor não precisa de .NET, de Node nem do repositório. Custos aceitos:
- A troca de CU do SQL Server depende de alguém lembrar dela.
- O `publish` monta as imagens de novo a partir do cache. Se o cache faltar, a imagem sai de um build novo do mesmo commit, e não dos mesmos bytes do `prod`.
- **O cache do Actions alimenta uma imagem publicada.** Fica aceito: o cache que a `main` lê só é gravado pela `main`, e o de um PR fica no escopo dele. O zizmor marca esse cache no `prod`, e a marcação fica suprimida no próprio passo.
- O `concurrency` do CI cancela o run anterior da `main`: um commit seguido de outro logo depois pode não ganhar imagem própria.
- Uma vulnerabilidade nova com correção quebra o job `prod` em qualquer PR, até alguém subir a base ou registrar a exceção.
- As imagens são só `linux/amd64`, sem assinatura nem SBOM.
