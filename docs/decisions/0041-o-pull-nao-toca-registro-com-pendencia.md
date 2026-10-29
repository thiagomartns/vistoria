# 0041 — O pull não toca registro com pendência

- **Status:** Proposto
- **Data:** 2026-10-29

## Contexto

A [Leitura (pull)](../architecture/frontend.md#leitura-pull) dizia que um registro com pendência não é sobrescrito e que "a versão do servidor fica guardada como `serverShadow`". A `serverShadow` é a store confirmada (`confirmedOf`, `shared/sync/upsert.ts`), de onde saem o `If-Match` e a base do merge do [Conflito](../architecture/frontend.md#conflito). Se o pull a atualizasse com pendência, o 412 seguinte faria o merge com base = `current`: o que só o outro aparelho mudou pareceria mudado aqui, e o local venceria sem conflito. Além disso, o cursor da [Leitura por delta](../architecture/backend.md#leitura-por-delta) passa do registro pulado: se a pendência some sem envio, o registro fica velho até mudar de novo no servidor. O spike 3 mostrou que, até o delta, um aparelho só recebe o que o outro gravou no próprio envio seguinte.

## Decisão

Pendência é uma transação do registro na fila (inclusive a que está em voo e a exclusão, com `deleting`) ou um rascunho de qualquer status (`draft`, `rejected`, `conflict`). Com pendência, o pull não grava os `items`, não aplica os `deletedIds` e não muda a store confirmada. Quem reconcilia é o 412 ou o 410 do envio, como no M3. A pendência é conferida ao aplicar a página, na mesma transação local que grava o cursor, e não quando a requisição saiu, então uma escrita feita durante o pull vence. O registro pulado ganha uma marca nessa transação (entidade e id, sem a versão). O resync completo marca os registros com pendência que preserva. No começo de cada ciclo de pull (um gatilho é a outbox esvaziar, e descartar um rascunho dispara um ciclo), a marca de um registro que já não tem pendência é resolvida pelo `GET` por id (`shared/sync/fetch.ts`), com a mesma regra: se o registro voltou a ter pendência, a resposta é descartada e a marca fica. O 404 remove o registro local, e sem rede a marca fica. Um item com a mesma `version` da store confirmada (o eco da própria escrita) não regrava o registro nem toca o rascunho (`rebasedAt`).

## Consequências

A base do merge continua a versão sobre a qual a edição foi feita. Nenhum registro fica velho até a próxima mudança no servidor. A marca não guarda a versão: a `version` é opaca, e aplicar uma versão guardada exigiria saber qual é a mais nova. Um 2xx que chega depois da página, ou um resolver que adota um `current` mais velho, a faria regredir ou se perder. Custos aceitos:
- A vistoria em andamento tem rascunho `draft` até concluir ([ADR 0036](0036-rascunho-da-vistoria-guarda-o-passo-e-fica-ate-concluir.md)), então o pull nunca a atualiza. O que outro aparelho gravou chega pelo 412 do próximo envio ou pelo `GET` da marca depois de concluir ou descartar, e uma vistoria excluída em outro aparelho fica na lista até o 410 ou até o rascunho sair.
- Um `GET` a mais por registro pulado, inclusive pelo eco de um envio que estava em voo durante o pull.
- Se a pendência sai sem rede, o registro fica velho até o próximo ciclo de pull com rede.
- Uma collection local a mais (as marcas), apagada com o banco do usuário no logout.
