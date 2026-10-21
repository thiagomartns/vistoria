# 0028 — Id do registro só na rota, e PUT sempre regrava

- **Status:** Proposto
- **Data:** 2026-10-21

## Contexto

A issue #22, o primeiro upsert do domínio (`PUT /api/v1/clients/{id}`), deixou duas perguntas para todo `PUT` de [Endpoints](../architecture/backend.md#endpoints). A primeira é o que fazer com um `id` no corpo diferente do da rota. A segunda é se um `PUT` com os mesmos valores grava. O critério de aceite pedia "o mesmo id de novo → 200 + `ETag` diferente", mas o EF Core não emite `UPDATE` quando nenhum valor muda: a versão ficava a mesma e a versão-base nem era conferida.

## Decisão

O id do registro vem só da rota. O DTO de entrada não tem `id` nem `version` (a versão-base vai no `If-Match`), e um `id` no corpo é ignorado como qualquer campo desconhecido. Na vistoria isso vale para a raiz; `rooms[].id` e `items[].id` continuam no corpo. Todo `PUT` aceito regrava o registro e sobe a versão, mesmo sem mudança (`GenericRepository.UpdateAsync` marca a entrada `Modified`).

## Consequências

Não existe "id da rota diferente do corpo" para validar nem para errar, e o front pode mandar o registro local inteiro. A versão sobe a cada escrita aceita, então o `ETag` devolvido é sempre o da escrita que o aparelho acabou de fazer, e a versão-base é sempre conferida. Custo aceito: um `PUT` reenviado sem mudança gera um `UPDATE`, uma versão nova e uma entrada no delta dos outros aparelhos. A idempotência (M2) evita isso nos retries, mas não num reenvio com chave nova. Um campo digitado errado no corpo também é ignorado sem aviso.
