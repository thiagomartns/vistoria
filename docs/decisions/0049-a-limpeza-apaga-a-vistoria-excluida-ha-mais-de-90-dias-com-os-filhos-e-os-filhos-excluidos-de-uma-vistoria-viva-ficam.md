# 0049 — A limpeza apaga a vistoria excluída há mais de 90 dias com os filhos, e os filhos excluídos de uma vistoria viva ficam

- **Status:** Proposto
- **Data:** 2026-11-02

## Contexto

As [regras gerais](../architecture/backend.md#entidade-sincronizável) prometem que tombstones com mais de 90 dias são apagados fisicamente pelo `CleanupService`, e o `cursor-expired` do [delta](../architecture/backend.md#leitura-por-delta) conta com essa retenção. A vistoria tem `DELETE` desde o M3, mas o serviço só apagava `Idempotency-Key` vencida (#124). Faltava decidir o que sai junto, o que fica e o que acontece com um `PUT` num id que já não existe.

## Decisão

No mesmo ciclo das chaves, um `DELETE` só (`ExecuteDeleteAsync`, sem trava) apaga as vistorias com `DeletedAt` anterior a `agora − SyncConfig.TombstoneRetention`, de todos os donos; ambientes e itens saem pelo `ON DELETE CASCADE` que a migração já tinha. No limite exato a vistoria fica, como o cursor e a chave. Uma excluída que outra vistoria referencia (`ReferenceInspectionId`, FK `Restrict`) fica, para não derrubar o statement inteiro. Ambientes e itens excluídos de uma vistoria **viva** não são limpos. Só a vistoria: cliente, imóvel e roteiro não têm `DELETE` na V1.

## Consequências

O banco deixa de crescer com tombstones, e a promessa do `cursor-expired` passa a ser real. Custos aceitos:
- Depois da purga, um `PUT` no id apagado cria a vistoria de novo (201), não 410, e os ids dos ambientes e itens dela ficam livres. Quem ainda a tinha e ficou 90 dias sem sincronizar recebe `cursor-expired` e refaz o sync; um `PUT` parado na outbox por 90 dias passou da janela offline de 72 h e do refresh de 7 dias, e só sai depois de entrar de novo.
- Filhos excluídos de vistoria viva ficam para sempre. Não servem ao delta (a vistoria viva vai inteira), mas apagá-los correria contra o `PUT` que os revive: o `UPDATE` do filho afetaria 0 linhas e viraria `DbUpdateConcurrencyException`. São poucas linhas por edição; se pesarem, é outra issue.
- A consulta varre a tabela de vistorias sem índice em `DeletedAt`, uma vez por hora. No volume de estudo não pesa.
- Uma vistoria referenciada nunca é purgada enquanto a referência existir (hoje impossível: a referência é de uma entrada concluída, que não pode ser excluída).
