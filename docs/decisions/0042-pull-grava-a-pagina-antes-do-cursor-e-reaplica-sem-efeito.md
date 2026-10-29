# 0042 — Pull grava a página antes do cursor e reaplica sem efeito

- **Status:** Proposto
- **Data:** 2026-10-29

## Contexto

A [Leitura (pull)](../architecture/frontend.md#leitura-pull) e o [ADR 0041](0041-o-pull-nao-toca-registro-com-pendencia.md) dizem que cada página é aplicada "numa transação local" junto com o cursor. A collection IndexedDB do TanStack DB 0.15 grava cada store numa transação IDB própria (`acceptMutations` só escreve a store dela). Uma transação nativa sobre registros, marcas e cursor teria de escrever por fora da collection, nos internos dela (a store `_versions` e o cache de versões), e as live queries não veriam a mudança. Além disso, "transação na fila" precisa ser lida sem `await`: o `peekOutbox` é assíncrono e não vê uma escrita que acabou de entrar.

## Decisão

A página é gravada em ordem: os registros na store confirmada, depois as marcas dos registros pulados e por último o cursor, cada gravação esperada até persistir. Se o pull cair no meio, o cursor ainda é o da página anterior, e a mesma página volta. Reaplicá-la não muda nada: o item com a `version` que a store já tem é o eco (não regrava), a exclusão do que já saiu não acha o registro, e a marca que já existe não é gravada de novo. A pendência da fila é lida da camada otimista da collection (`$hasPendingWrites`), na hora, e a conferência e o início da gravação ficam no mesmo tick, sem `await` entre eles.

## Consequências

A retomada continua da última página aplicada, e nenhuma página é baixada duas vezes, exceto a que caiu entre os registros e o cursor. O pull usa só a API pública da collection. Custos aceitos:
- Uma página pode ser baixada e conferida duas vezes, quando o pull cai entre os registros e o cursor.
- A gravação IDB da página leva alguns milissegundos depois da conferência. Uma escrita que caia nessa janela sai com a `version` nova da store, e o formulário só recarrega os campos intocados logo depois.
- `$hasPendingWrites` é sempre falso numa collection `localOnly`. Os testes do pull usam uma collection com sync próprio, como a IndexedDB.
