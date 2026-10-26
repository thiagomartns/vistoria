# 0035 — Ambiente e item do agregado sobre AggregateChild, sem SyncEntity

- **Status:** Aceito
- **Data:** 2026-10-23

## Contexto

A regra "toda entidade do domínio herda de `SyncEntity`" (`apps/api/CLAUDE.md`) daria a `Room` e `InspectionItem` rowversion, dono e datas próprios. Mas a [Regra do agregado](../architecture/backend.md#entidade-sincronizável) diz que eles não têm versão: a vistoria é escrita inteira num `PUT` e versionada só na raiz, e ETag e delta só olham a raiz. Eles ainda precisam de `Id` do cliente e de `DeletedAt`, porque o ambiente ou item omitido no `PUT` vira soft delete (#25).

## Decisão

`Room` e `InspectionItem` herdam de `AggregateChild` (`Id`, `DeletedAt`), com chave do cliente e o filtro `SoftDelete` aplicados pelo `AppDbContext`, como na `SyncEntity`. No `SaveChangesAsync`, incluir, alterar ou remover um filho marca a vistoria como `Modified`, e o `UPDATE` dela sobe o rowversion. `Remove` de filho vira `DeletedAt`. Gravar um filho sem a vistoria rastreada no mesmo contexto lança `InvalidOperationException`.

## Consequências

Uma versão só por agregado, garantida no contexto: nenhum caminho grava um item sem subir o ETag da vistoria. O custo aceito: o filho não tem `CreatedAt`, `UpdatedAt` nem dono próprios, então "quando este item mudou" só se responde pela raiz. Todo código que escreve filhos precisa carregar a vistoria rastreada, mesmo para mudar um item só. A limpeza física de tombstones de filhos ainda não existe.
