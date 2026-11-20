# 0063 — O telefone é guardado só com dígitos: a API normaliza a entrada com máscara ou +55, só números brasileiros, e a máscara é só da UI (#215)

- **Status:** Proposto
- **Data:** 2026-11-20

## Contexto

O CPF/CNPJ e o CEP já iam sem máscara para o banco e para o contrato ([Client, Property e Template](../vision.md#client-property-e-template)). O telefone, não: era texto livre de até 20 caracteres, e o mesmo número aparecia como `(71) 99999-0000`, `71999990000` ou `+55 71 9 9999 0000`, inclusive no `pnpm seed`. Um aparelho pode ter na outbox um cliente com o telefone no formato antigo, e uma regra nova na API não pode recusar o que já estava na fila antes do deploy ([Escrita](../architecture/backend.md#escrita)).

## Decisão

- **Canônico:** só dígitos, DDD e número. O DDD é um dos 67 da Anatel. O fixo tem 10 dígitos, com o número começando de 2 a 5. O celular tem 11, com o número começando por 9. Só números brasileiros na V1.
- **A API normaliza antes de validar** (`[Telefone]`): tira tudo que não é dígito e, com 12 ou 13 dígitos começando por `55`, tira o `55` do país. O `ClientService` grava o normalizado, e a resposta já volta com ele. O CPF/CNPJ e o CEP continuam recusando a máscara, porque a UI sempre os mandou sem ela.
- **Migração:** o telefone que se encaixa na regra vira o canônico. O resto fica como está, nunca apagado, e o próximo `PUT` dele cai no 400 `validation` em `phone`. O `UPDATE` sobe o rowversion só das linhas que mudam, e o delta as reenvia.
- **A máscara é só da UI,** ao digitar (`MaskedInput`) e ao mostrar. O formulário entrega à outbox o mesmo canônico da API.

## Consequências

A fila antiga passa sem 400, e qualquer telefone gravado de agora em diante tem um formato só, o que deixa a busca e a comparação do conflito pelo valor. Custos aceitos:
- A API aceita entrada com máscara no telefone e recusa no documento: são duas regras de entrada para a mesma ideia.
- Número de fora do Brasil e o telefone antigo que não se encaixa só aparecem ao editar o cliente, como erro no campo.
- A coluna continua com 20 caracteres, para caber o que não converteu.
- Digitar o `+55` caractere a caractere mostra o 55 como DDD até passar de 11 dígitos; colar com `+55` dá certo.
