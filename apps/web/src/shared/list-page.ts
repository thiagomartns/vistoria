// As listas montam uma página por vez, com "Mostrar mais" (ADR 0047 e #223): a busca e os filtros correm sobre todos
// os registros do aparelho, antes do corte, e só a página vira linha na tela.

/** Quantas linhas cada página da lista monta. */
export const LIST_PAGE_SIZE = 50;

/** O substantivo do contador, no singular e no plural. */
export interface CountNoun {
  one: string;
  many: string;
}

/** "6 imóveis", "1 cliente"; com a lista cortada, "50 de 2.500 imóveis". */
export function countLabel(shown: number, total: number, noun: CountNoun): string {
  const word = total === 1 ? noun.one : noun.many;
  const all = total.toLocaleString("pt-BR");
  return shown < total ? `${shown.toLocaleString("pt-BR")} de ${all} ${word}` : `${all} ${word}`;
}
