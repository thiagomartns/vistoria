// Funções puras do `pnpm layout:tables` (#208): sem rede nem navegador, para caberem em teste.

/** As larguras conferidas: o tablet, o notebook, o limite de baixo do desktop largo (1280) e o frame do Figma. */
export const WIDTHS = [768, 1024, 1279, 1440];

/** A largura do frame do Figma: nela, todas as colunas aparecem. */
export const FIGMA_WIDTH = 1440;

/** O mínimo da primeira coluna, a que nunca sai (ADR 0061). */
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

/** O nome do print a uma largura, no padrão do `pnpm screens --files` (a 1279 px não tem print). */
export function screenName(route, width) {
  const viewport = { 768: "tablet", 1024: "notebook", 1440: "desktop" }[width];
  return viewport ? `${route.replace(/^\/+/, "")}-${viewport}.png` : null;
}

/**
 * O que está errado numa tabela medida, em frases; vazio quando ela está certa.
 * `measure`: `{ headers: [{ text, width, visible }], spills: [{ text, column }], pageScrolls }`, como o roteiro mede
 * no navegador. `spills` são as células visíveis com o conteúdo mais largo que elas e sem corte: a sobreposição.
 */
export function tableProblems(measure, { width, columns }) {
  const problems = [];
  const visible = measure.headers.filter((header) => header.visible);
  const first = visible[0];
  if (!first || first.text !== columns[0]) {
    problems.push(`a primeira coluna devia ser "${columns[0]}", e é "${first?.text ?? "nenhuma"}"`);
  } else if (first.width < MIN_FIRST_COLUMN) {
    problems.push(`a coluna "${first.text}" tem ${Math.round(first.width)} px, menos que ${MIN_FIRST_COLUMN}`);
  }
  for (const spill of measure.spills) {
    problems.push(`"${spill.text}" passa da célula na coluna "${spill.column}"`);
  }
  if (measure.pageScrolls) problems.push("a página rola na horizontal: a rolagem tem de ficar dentro da borda");
  if (width >= FIGMA_WIDTH) {
    const shown = new Set(visible.map((header) => header.text));
    const missing = columns.filter((column) => !shown.has(column));
    if (missing.length > 0) problems.push(`a ${FIGMA_WIDTH} px faltam colunas do Figma: ${missing.join(", ")}`);
  }
  return problems;
}
