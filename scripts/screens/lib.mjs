// Funções puras do `pnpm screens`: sem rede, navegador nem disco, para caberem em teste.

/** Tamanhos dos frames do Figma (celular e desktop). */
export const VIEWPORTS = [
  { name: "celular", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

/** Branch órfã que guarda os prints dos PRs; nunca entra na `main`. */
export const SCREENS_BRANCH = "screens";

/**
 * Caminhos candidatos, relativos a `apps/web/out`, para uma rota do static export.
 * A query é ignorada: `/inspections/edit?id=1` serve `inspections/edit.html`.
 */
export function candidateFiles(route) {
  const path = decodeURIComponent(new URL(route, "http://x").pathname).replace(/^\/+|\/+$/g, "");
  if (path === "") return ["index.html"];
  if (/\.[a-z0-9]+$/i.test(path)) return [path];
  return [`${path}.html`, `${path}/index.html`];
}

/** `/inspections/edit?id=1` → `inspections-edit-id-1`; a raiz vira `inicio`. */
export function routeSlug(route) {
  const slug = route
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "inicio" : slug;
}

export function screenshotName(route, viewport) {
  return `${routeSlug(route)}-${viewport}.png`;
}

/** Caminho na branch `screens`: uma pasta por branch da issue. */
export function publishPath(gitBranch, fileName) {
  return `${gitBranch.replace(/^\/+|\/+$/g, "")}/${fileName}`;
}

export function rawUrl(nameWithOwner, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${nameWithOwner}/${SCREENS_BRANCH}/${encoded}`;
}

/** Tabela para o corpo do PR: uma linha por rota, uma coluna por viewport. */
export function markdownTable(rows) {
  const header = `| Rota | ${VIEWPORTS.map((v) => v.name[0].toUpperCase() + v.name.slice(1)).join(" | ")} |`;
  const divider = `| --- | ${VIEWPORTS.map(() => "---").join(" | ")} |`;
  const lines = rows.map(
    ({ route, urls }) =>
      `| \`${route}\` | ${VIEWPORTS.map((v) => `<img src="${urls[v.name]}" width="${v.name === "celular" ? 240 : 480}">`).join(" | ")} |`,
  );
  return [header, divider, ...lines].join("\n");
}

/** Lê `rota… [--publish] [--out dir]`. */
export function parseArgs(argv) {
  const routes = [];
  let publish = false;
  let out = ".screens";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--publish") publish = true;
    else if (arg === "--out") out = argv[++i] ?? out;
    else if (arg.startsWith("--")) throw new Error(`Opção desconhecida: ${arg}`);
    else routes.push(arg.startsWith("/") ? arg : `/${arg}`);
  }
  if (routes.length === 0) throw new Error("Uso: pnpm screens <rota…> [--publish] [--out dir]");
  return { routes, publish, out };
}
