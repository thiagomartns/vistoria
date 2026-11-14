// Funções puras do `pnpm screens`: sem rede, navegador nem disco, para caberem em teste.

/** Tamanhos dos frames do Figma (celular e desktop). */
export const VIEWPORTS = [
  { name: "celular", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

/**
 * Larguras a mais que só os PNGs prontos (`--files`) usam: o tablet e o notebook, entre o celular e o desktop (#208).
 * A ordem é a das colunas da tabela do PR.
 */
export const FILE_VIEWPORTS = [
  VIEWPORTS[0],
  { name: "tablet", width: 768, height: 1024 },
  { name: "notebook", width: 1024, height: 768 },
  VIEWPORTS[1],
];

const THUMB_WIDTH = { celular: 240, tablet: 320, notebook: 400, desktop: 480 };

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

/**
 * Tabela para o corpo do PR: uma linha por rota, uma coluna por viewport. Celular e desktop sempre; tablet e notebook
 * só quando alguma linha os tem, e a linha sem o print fica com a célula vazia.
 */
export function markdownTable(rows) {
  const viewports = FILE_VIEWPORTS.filter(
    (v) => VIEWPORTS.includes(v) || rows.some(({ urls }) => urls[v.name] !== undefined),
  );
  const header = `| Rota | ${viewports.map((v) => v.name[0].toUpperCase() + v.name.slice(1)).join(" | ")} |`;
  const divider = `| --- | ${viewports.map(() => "---").join(" | ")} |`;
  const cell = (url, v) => (url === undefined ? "" : `<img src="${url}" width="${THUMB_WIDTH[v.name]}">`);
  const lines = rows.map(
    ({ route, urls }) => `| \`${route}\` | ${viewports.map((v) => cell(urls[v.name], v)).join(" | ")} |`,
  );
  return [header, divider, ...lines].join("\n");
}

/** Lê `rota… [--publish] [--out dir]`. */
export function parseArgs(argv) {
  const routes = [];
  let publish = false;
  let session = false;
  let out = ".screens";
  let files = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--publish") publish = true;
    else if (arg === "--session") session = true;
    else if (arg === "--out") out = argv[++i] ?? out;
    else if (arg === "--files") files = argv[++i] ?? null;
    else if (arg.startsWith("--")) throw new Error(`Opção desconhecida: ${arg}`);
    else routes.push(arg.startsWith("/") ? arg : `/${arg}`);
  }
  if (files !== null) {
    if (routes.length > 0) throw new Error("--files publica PNGs prontos: sem rotas.");
    return { routes, publish: true, session, out, files };
  }
  if (routes.length === 0) {
    throw new Error("Uso: pnpm screens <rota…> [--session] [--publish] [--out dir] | --files dir");
  }
  return { routes, publish, session, out, files };
}

/**
 * Os PNGs prontos de uma pasta (`<nome>-celular.png`, `<nome>-desktop.png`, e também `-tablet` e `-notebook`), gerados
 * fora do `pnpm screens` (o roteiro da tela de campo tira os prints dos estados que dependem do servidor). O nome vira
 * a linha da tabela do PR.
 */
export function readyScreens(names) {
  const viewports = FILE_VIEWPORTS.map((viewport) => viewport.name).join("|");
  const pattern = new RegExp(`^([a-z0-9-]+)-(${viewports})\\.png$`);
  return names
    .map((name) => pattern.exec(name))
    .filter(Boolean)
    .map(([name, route, viewport]) => ({ route, viewport, name }))
    .toSorted((a, b) => a.route.localeCompare(b.route) || a.viewport.localeCompare(b.viewport));
}
