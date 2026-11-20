// A tabela das listas no desktop (#222, ADR 0064): a página rola inteira, como no celular, e o cabeçalho da tabela fica
// no topo do `main` do shell.
//
// A caixa da borda usa `overflow-clip`, nunca `overflow-hidden`: como item flex do `main`, a caixa com `overflow-hidden`
// tem altura mínima 0, e o flex a encolhia até caber na tela, cortando as linhas sem a página rolar. Com `clip`, ela
// corta só os cantos e não vira contêiner de rolagem, o que deixa o `sticky` do cabeçalho prender no `main`.
//
// O `Table` do Sanjou embrulha a tabela num container com `overflow-x-auto`, que também é contêiner de rolagem: cada
// lista o deixa `visible` com a container query do `min-w` da sua tabela (`@min-[Npx]:*:data-[slot=table-container]:
// overflow-x-visible`, literal em cada lista, para o Tailwind gerar). Abaixo do `min-w`, a tabela rola dentro da borda
// (ADR 0061), e só o cabeçalho deixa de prender.

/**
 * O `className` do `TableHeader` das listas: os `th` presos no topo do `main`, que tem `md:p-6` (daí o `-top-6`), acima
 * do "···" e do link que cobre a linha (`z-10`), com fundo e a linha de baixo numa sombra, que acompanha o `th` preso (a
 * borda do `tr` fica para trás).
 */
export const STICKY_TABLE_HEADER =
  "[&_th]:sticky [&_th]:-top-6 [&_th]:z-20 [&_th]:bg-background [&_th]:shadow-[inset_0_-1px_0_var(--color-border)]";
