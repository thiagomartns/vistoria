# 0067 — O endereço pelo CEP vem da nossa API, pelo ViaCEP com a BrasilAPI de reserva, com cache em memória, o type upstream-unavailable e a consulta fora da outbox (#185)

- **Status:** Proposto
- **Data:** 2026-11-22

## Contexto

Rua, bairro, cidade e UF do imóvel eram digitados à mão em `/properties/edit`. Preencher pelo CEP é o padrão brasileiro, e o ViaCEP (gratuito, sem chave, base dos Correios) é a fonte pública mais usada. A BrasilAPI junta vários provedores e serve de reserva. Mas a CSP do shell é `connect-src 'self'` ([Segurança](../architecture/frontend.md#segurança)), então o front não chama terceiros. O app é local-first: a consulta é só uma ajuda, e offline o cadastro segue à mão. O catálogo de erros não tinha um `type` para um provedor externo fora. O `internal` quer dizer bug nosso, e o `GlobalExceptionHandler` o registra como exceção não tratada.

## Decisão

`GET /api/v1/zip-codes/{zipCode}` (`getAddressByZipCode`) é autenticado, com rate limit próprio por IP. Ele consulta o ViaCEP e, quando ele falha ou não conhece o CEP, a BrasilAPI. A resposta sai no formato do `Property`, com `null` no que o provedor não traz. Cada provedor tem o próprio `HttpClient`, com o handler de resiliência padrão ajustado. O resultado fica num `HybridCache` em memória. Os dois provedores fora → 503 com o `type` novo `upstream-unavailable`. No front, o formulário consulta quando a pessoa completa o CEP, com rede. Ele preenche só os campos vazios, ou os que a consulta anterior pôs e ninguém mexeu, e mostra a dica sob o campo. A consulta não passa pela outbox nem fica no banco local.

## Consequências

O cadastro de imóvel fica mais rápido e com menos erro de digitação. Uma queda de provedor aparece no log como erro do catálogo, não como bug. Custos aceitos:
- O CEP do imóvel do cliente vai para um terceiro. É dado de baixo risco, que não identifica pessoa. O provedor não recebe o IP do aparelho nem o usuário, e o log da API não guarda o CEP.
- **A API passa a depender de serviços externos.** Na pior hora, a consulta leva até 8 s, os dois provedores fora. O cache vale por instância e some com o restart.
- O cache segura um CEP novo como "não existe" por 1 dia.
- Os roteiros não testam o provedor de verdade: o `launch()` responde a consulta com um falso, e os testes da API usam handlers falsos. A compatibilidade com o ViaCEP e com a BrasilAPI só se vê em uso.
- Um `type` novo no catálogo, que o `handleProblem` põe no grupo `retry`. O formulário não tenta de novo sozinho: a pessoa redigita o CEP ou preenche à mão.

Afeta o [Contrato da API](../architecture/backend.md#contrato-da-api) (rota e catálogo), os [Parâmetros compartilhados](../architecture/backend.md#parâmetros-compartilhados) e a [Camada de dados local-first](../architecture/frontend.md#camada-de-dados-local-first).
