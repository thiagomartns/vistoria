# 0061 — As colunas secundárias das listas saem pela largura da tabela, por container query, com 180 px de mínimo para a primeira coluna e rolagem dentro da borda como piso (#208)

- **Status:** Proposto
- **Data:** 2026-11-14

## Contexto

As tabelas de `/clients`, `/properties`, `/inspections` e `/templates` usam `table-fixed`, com as colunas de largura fixa do frame de 1440 px ([UX de sincronização e Sanjou UI](../architecture/frontend.md#ux-de-sincronização-e-sanjou-ui)). Com a sidebar, a tabela tem 478 px a 768 e 734 px a 1024. A soma das colunas fixas passava disso (880 px em clientes), e a primeira coluna, a única sem largura, ficava com 0 px, com o cabeçalho por cima do da coluna vizinha. O Figma só tem frames de 390 e 1440 px, e o teste manual pegou o defeito no tablet. Esconder colunas pela largura da janela (`lg:`) erraria sempre que a sidebar ou o padding mudassem.

## Decisão

Cada coluna secundária só aparece quando a tabela tem largura para as colunas visíveis mais 180 px para a primeira. A regra é uma container query (`@container` no `div` da borda e `hidden @min-[Npx]:table-cell` na coluna), e as classes ficam num mapa por lista, usado no cabeçalho e no corpo. A primeira coluna e a Sincronização nunca saem, e Status e Ações, na de vistorias, também não. A ordem de saída segue o que o `ListRow` do celular já deixa de fora. O `min-w` da tabela é o piso, com só as colunas que nunca saem. Abaixo dele, a tabela rola na horizontal dentro da borda. A 1440 px aparecem todas as colunas do Figma. O `pnpm layout:tables` confere isso a 768, 1024, 1279 e 1440 px no CI.

## Consequências

Nenhuma largura entre o tablet e o desktop sobrepõe colunas, e a regra acompanha a largura real da tabela. Custos aceitos:
- Entre 768 e 1279 px, a tabela mostra menos do que o Figma, e quem precisa do e-mail ou do CPF abre o registro ou alarga a janela.
- Os limites são números à mão (a soma das larguras mais 180). Mudar a largura de uma coluna é refazer os limites dela e das que saem antes.
- A `/inspections` a 768 px rola 78 px, sem coluna fixa: as Ações ficam fora da tela até rolar.
