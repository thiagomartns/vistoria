# 0062 — O 429 ou 5xx no refresh de abertura não expira a sessão: fica renewing e tenta de novo depois do Retry-After ou do backoff (#210)

- **Status:** Proposto
- **Data:** 2026-11-16

## Contexto

O access token fica só em memória, então um reload abre com o dono e sem token, e renova antes de tudo ([Sessão](../architecture/frontend.md#segurança)). Pelo [ADR 0045](0045-o-unauthorized-se-renova-no-client-que-reenvia-a-mesma-requisicao-refresh-sem-resposta-nao-expira-a-sessao-token-renovado-de-outro-usuario-nao-vale.md), o refresh sem resposta (rede, 429, 5xx) não decide nada. Na abertura, porém, a sessão via dono sem token e sem renovação em curso e caía em `expired`, e com rede o shell mandava para o `/login`. O ADR 0045 aceitava isso como custo. A sondagem da #208 mostrou o efeito: reloads seguidos passam do limite de 30 refreshes por minuto e IP e levam ao "Sua sessão expirou" com o cookie válido. Fora do teste, o mesmo acontece com vários vistoriadores atrás de um IP só (NAT de escritório) e com Wi-Fi sem internet.

## Decisão

Só o refresh recusado (`renew-session`) expira a sessão. Sem token, o refresh sem resposta deixa a sessão `renewing` e agenda o próximo: com o `Retry-After` do 429, que nenhum outro gatilho antecipa, ou com backoff de 1, 2, 4… s sem ele, que a volta da rede antecipa. Os dois prazos param em 60 s. O token anunciado por outra aba, o login, a saída e o refresh recusado cancelam o agendamento. Com token, nada muda: o client lança erro de rede e a fila faz o backoff dela. Este ADR revê esse custo aceito do 0045, sem substituir as decisões dele.

## Consequências

Recarregar perto do limite, ou abrir com a API fora, mostra os dados locais em vez do `/login`, e a sessão volta sozinha. Custos aceitos:
- Com a API fora do ar por muito tempo, a sessão fica `renewing` indefinidamente, com a outbox e o pull parados e sem aviso próprio. O indicador de pendências e a janela offline de 72 h são os sinais.
- Um aparelho com o cookie já revogado só descobre isso quando o refresh responde. Até lá, abre com os dados locais em vez do login.
- O `Retry-After` vale também para a volta da rede, então um 429 pode segurar o refresh até 60 s depois de a rede voltar.
