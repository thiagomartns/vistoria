# 0027 — Credencial inválida com type próprio (invalid-credentials), complementando o ADR 0018

- **Status:** Aceito
- **Data:** 2026-10-20

## Contexto

A issue #20 pedia que credencial inválida no `signin` respondesse 401 `unauthorized`. No [catálogo de erros](../architecture/backend.md#catálogo-de-erros), porém, a reação a `unauthorized` é "pausa a fila, refresh em aba única, retoma", que serve para access token ausente ou vencido. Credencial errada pede outra reação: a tela de login mostra "E-mail ou senha incorretos.". Com um `type` só para os dois casos, o mesmo `type` teria duas reações e o front precisaria olhar a rota, contra o [ADR 0018](0018-erros-pelo-type.md).

## Decisão

O `signin` responde 401 `invalid-credentials`, o mesmo para senha errada e para e-mail inexistente. `unauthorized` fica só para o 401 do JwtBearer (token ausente, inválido ou vencido). Complementa o ADR 0018, sem substituí-lo.

## Consequências

Cada `type` continua com uma reação, e o login não enumera usuários: as duas falhas têm o mesmo corpo, e o e-mail inexistente também roda o PBKDF2, então nem o tempo de resposta as separa. O front mostra a mensagem pelo `type`, nunca pelo `detail`. Custo aceito: um `type` a mais no catálogo fechado, mantido nos dois lados, e o build do front quebra até `invalid-credentials` ganhar a reação dele.
