# 0045 — O unauthorized se renova no client, que reenvia a mesma requisição; refresh sem resposta não expira a sessão; token renovado de outro usuário não vale (#132)

- **Status:** Proposto
- **Data:** 2026-10-31

## Contexto

Com o refresh na API (#126), o grupo "Renovar sessão" da [Reação aos erros](../architecture/frontend.md#reação-aos-erros) pede pausar a fila, renovar numa aba só e retomar a **mesma** transação com a **mesma** chave. Antes, a outbox, o pull e o `GET` por id expiravam a sessão cada um por conta própria. O refresh pode falhar sem decidir nada (sem rede, 429, 5xx). E o cookie é do navegador, não da aba: outra aba que entrou com outra conta troca o cookie desta ([Sessão](../architecture/frontend.md#segurança)).

## Decisão

- O `fetch` do client (`shared/api/client.ts`) trata o `unauthorized` (pelo `type`) fora de `/auth/*`: espera a renovação da sessão e reenvia a requisição uma vez, com o token novo e os mesmos cabeçalhos e corpo. Se outra chamada já renovou, reenvia sem outro refresh.
- O refresh recusado (`unauthorized`) expira a sessão; o refresh sem resposta vira falha de rede, e a fila tenta de novo sem expirar. Um `unauthorized` que chega a quem chamou quer dizer sessão expirada de verdade.
- O token renovado cujo `sub` não é o dono do aparelho não é aplicado: a sessão expira.

## Consequências

Um lugar só para a renovação, que vale para a outbox, o pull e o `GET` por id. A outbox não sabe do refresh, e a chave se mantém porque o reenvio é a mesma requisição. Custos aceitos:
- O client lê o corpo de toda requisição como texto, para poder reenviá-lo.
- Com a API fora do ar na abertura (e o `navigator.onLine` verdadeiro), a sessão cai em `expired` e vai para o `/login`, como antes, e só renova de novo quando a rede cai e volta.
- A conferência do `sub` lê o payload do JWT no front, sem validar a assinatura: só a API valida.
