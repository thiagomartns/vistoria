# 0024 — type de erro como URN

- **Status:** Aceito
- **Data:** 2026-10-20

## Contexto

O [catálogo de erros](../architecture/backend.md#catálogo-de-erros) usava slugs relativos no `type` (`"validation"`). A RFC 9457 recomenda URI absoluta: uma referência relativa é resolvida contra a URL da requisição, então `validation` vindo de `/api/v1/inspections/x` "significa" `/api/v1/inspections/validation`. Trocar agora custa uma constante; depois que a #16 publicar o enum `ProblemType` e o front gerar a union, vira migração.

## Decisão

O `type` é `urn:vistoria:problem:<slug>`, com o slug da tabela do catálogo. URN e não URL `https://`, porque o `type` identifica o erro, mas não há página publicada para ele. Complementa o [ADR 0018](0018-erros-pelo-type.md) (reação pelo `type`), sem substituí-lo.

## Consequências

O `type` segue a RFC e não depende da rota que o gerou. O prefixo fica numa constante de `ProblemTypes`; o doc continua listando só os slugs. Custo aceito: strings mais longas no `switch` do front e nos logs, e um prefixo que, se um dia mudar, muda todos os `type` de uma vez (um ADR novo).
