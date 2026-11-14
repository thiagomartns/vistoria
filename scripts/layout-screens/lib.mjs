// Funções puras do `pnpm layout:screens` (#208): sem rede nem navegador, para caberem em teste. Cada uma recebe o que
// o roteiro mediu numa tela, numa largura, e devolve o que está errado, em frases; vazio quando a tela está certa.

/** As larguras conferidas: o tablet, o notebook, logo abaixo do `xl`, logo acima do desktop da tela de campo e o Figma. */
export const WIDTHS = [768, 1024, 1279, 1366, 1440];

/** A largura do frame do Figma: nela, as listas mostram todas as colunas. */
export const FIGMA_WIDTH = 1440;

/** A partir daqui (`lg`), as listas são tabela e o editor de roteiro tem dois painéis (ADR 0061). */
export const LARGE = 1024;

/** A largura da StepperForm a partir da qual a tela de campo usa o layout de desktop (`stepper-wide`, no globals.css). */
export const STEPPER_WIDE = 1072;

/** O mínimo da primeira coluna das tabelas, a que nunca sai (ADR 0061). */
export const MIN_FIRST_COLUMN = 180;

/** As quatro listas e as colunas delas no Figma, na ordem da tela. */
export const LISTS = [
  { route: "/clients", columns: ["Nome", "CPF ou CNPJ", "E-mail", "Telefone", "Imóveis", "Sincronização"] },
  { route: "/properties", columns: ["Endereço", "Cliente", "Tipo", "Cidade", "Sincronização"] },
  {
    route: "/inspections",
    columns: ["Imóvel", "Cliente", "Tipo", "Status", "Início", "Sincronização", "Ações"],
  },
  { route: "/templates", columns: ["Nome", "Ambientes", "Itens", "Sincronização"] },
];

/** O nome do print a uma largura, no padrão do `pnpm screens --files` (só tablet, notebook e desktop têm print). */
export function screenName(name, width) {
  const viewport = { 768: "tablet", 1024: "notebook", 1440: "desktop" }[width];
  return viewport ? `${name}-${viewport}.png` : null;
}

/**
 * Em toda tela: a página não rola na horizontal, e nada visível do `main` passa da borda de quem o contém, fora de uma
 * faixa que rola de propósito (`overflow-x-auto`) e do texto com reticências. `measure`: `{ pageScrolls, outside:
 * [{ text, by }] }`, com `by` os px que passam.
 */
export function overflowProblems(measure) {
  const problems = [];
  if (measure.pageScrolls) problems.push("a página rola na horizontal");
  for (const { text, by } of measure.outside) problems.push(`"${text}" passa ${by} px da borda`);
  return problems;
}

/**
 * As listas: abaixo de `lg`, a lista do celular (`ListRow`) e nenhuma tabela; a partir dele, a tabela, com a primeira
 * coluna legível, nenhuma célula transbordando sem corte e, a 1440 px, todas as colunas do Figma. `measure`: `{ table:
 * { headers: [{ text, width, visible }], spills: [{ text, column }] } | null, rows }`, com `rows` as linhas do celular
 * visíveis.
 */
export function listProblems(measure, { width, columns }) {
  if (width < LARGE) {
    const problems = [];
    if (measure.table) problems.push(`abaixo de ${LARGE} px a lista devia ser a do celular, e é a tabela`);
    if (measure.rows === 0) problems.push("a lista do celular não tem linhas visíveis");
    return problems;
  }
  if (!measure.table) return [`a partir de ${LARGE} px a lista devia ser a tabela`];
  return tableProblems(measure.table, { width, columns });
}

/** A tabela de uma lista (ver `listProblems`). */
export function tableProblems(table, { width, columns }) {
  const problems = [];
  const visible = table.headers.filter((header) => header.visible);
  const first = visible[0];
  if (!first || first.text !== columns[0]) {
    problems.push(`a primeira coluna devia ser "${columns[0]}", e é "${first?.text ?? "nenhuma"}"`);
  } else if (first.width < MIN_FIRST_COLUMN) {
    problems.push(`a coluna "${first.text}" tem ${Math.round(first.width)} px, menos que ${MIN_FIRST_COLUMN}`);
  }
  for (const spill of table.spills) problems.push(`"${spill.text}" passa da célula na coluna "${spill.column}"`);
  if (width >= FIGMA_WIDTH) {
    const shown = new Set(visible.map((header) => header.text));
    const missing = columns.filter((column) => !shown.has(column));
    if (missing.length > 0) problems.push(`a ${FIGMA_WIDTH} px faltam colunas do Figma: ${missing.join(", ")}`);
  }
  return problems;
}

/**
 * A tela de campo: o trilho de ambientes (layout de desktop) só com a StepperForm a partir de `STEPPER_WIDE`, e nenhum
 * chip de condição cortado. `measure`: `{ stepper, rail, truncatedChips: [text] }`, com `stepper` a largura da
 * StepperForm e `rail` se os ambientes estão em coluna.
 */
export function fieldProblems(measure) {
  const problems = [];
  const wide = measure.stepper >= STEPPER_WIDE;
  if (measure.rail !== wide) {
    problems.push(
      `com a StepperForm de ${Math.round(measure.stepper)} px, o layout devia ser o ${wide ? "de desktop" : "do celular"}`,
    );
  }
  for (const text of measure.truncatedChips) problems.push(`o chip "${text}" está cortado`);
  return problems;
}

/** O editor de roteiro: dois painéis a partir de `lg`, os dois níveis do celular abaixo. `measure`: `{ twoPanels }`. */
export function editorProblems(measure, { width }) {
  const expected = width >= LARGE;
  if (measure.twoPanels === expected) return [];
  return [`a ${width} px o editor devia ter ${expected ? "dois painéis" : "os dois níveis do celular"}`];
}
