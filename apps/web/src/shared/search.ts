// Busca local (ADR 0007): as listas filtram e ordenam no aparelho, sem acento e sem caixa.

/** Sem acento e sem caixa, para a busca e a ordem. */
export const fold = (value: string): string =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

/** Ordem alfabética em português, sem caixa nem acento; "Rua 2" antes de "Rua 10". */
export const byText = (a: string, b: string): number =>
  a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
