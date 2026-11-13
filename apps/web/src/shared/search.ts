// Busca local (ADR 0007): as listas filtram e ordenam no aparelho, sem acento e sem caixa.

/** Sem acento e sem caixa, para a busca e a ordem. */
export const fold = (value: string): string =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

// Um collator só: o `localeCompare` com locale e opções monta um a cada chamada, e ordenar os 2.500 imóveis do spike 2
// assim custava centenas de milissegundos no celular. A ordem é a mesma.
const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Ordem alfabética em português, sem caixa nem acento; "Rua 2" antes de "Rua 10". */
export const byText = (a: string, b: string): number => COLLATOR.compare(a, b);
