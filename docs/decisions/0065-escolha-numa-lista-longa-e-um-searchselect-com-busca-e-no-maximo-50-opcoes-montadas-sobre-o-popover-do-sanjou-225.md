# 0065 — Escolha numa lista longa é um SearchSelect, com busca e no máximo 50 opções montadas, sobre o Popover do Sanjou (#225)

- **Status:** Proposto
- **Data:** 2026-11-21

## Contexto

Com o `pnpm seed`, o filtro Imóvel de `/inspections` levava ~800 ms para abrir no desktop e ~2,8 s no celular com CPU 4×: o Select do Radix monta um item por opção (2.501), e o `FilterSelect` só evitava montá-los fechado. A Nova vistoria montava os 2.500 imóveis mesmo com o campo fechado, e o formulário de imóvel, os 500 clientes. O Sanjou 0.2.0 não tem Combobox nem Command, só `Popover` ([ADR 0020](0020-componentes-que-faltam-no-sanjou-ficam-no-app.md)). As opções vêm do banco local, sem busca no servidor ([ADR 0007](0007-busca-so-no-banco-local.md)).

## Decisão

Toda escolha entre centenas ou milhares de registros do aparelho (Cliente e Imóvel nos filtros, o Imóvel da Nova vistoria, o Cliente do imóvel) é o `SearchSelect` (`shared/components/search-select.tsx`). Ele usa o mesmo gatilho do `SelectTrigger` e, aberto, o `Popover` do Sanjou com a busca (o `fold` de `shared/search.ts`). A lista monta no máximo 50 opções, com "Mais N: refine a busca" embaixo, e o "todos" e o escolhido sempre visíveis. As opções só são lidas aberto. A semântica é `combobox` e `listbox`, com setas, Enter e Esc. Tipo, Status, Período e Roteiro, com poucas opções, continuam no Select.

## Consequências

O filtro Imóvel abre em 128 ms no celular e em 45 ms no desktop, com metas fixas no `spike:volume` ([Spike 2](../architecture/frontend.md#riscos-e-spikes)). Custos aceitos:
- A rolagem não chega às opções depois das 50 primeiras: para elas, é preciso buscar. Com 2.500 imóveis, rolar não seria um caminho real, mas a lista não é mais o catálogo inteiro.
- O componente copia as classes do `SelectTrigger` e do `SelectItem` do Sanjou, porque o app não tem o `cn` dele nem um Combobox. Se o Sanjou mudar o visual dos dois, o `SearchSelect` fica diferente sem quebrar o build, até o Combobox subir para o Sanjou (candidato).
- O Popover é `modal` e não vira para cima: dentro do Sheet "Filtros", ele prende o foco e encolhe até a altura disponível embaixo do campo.
