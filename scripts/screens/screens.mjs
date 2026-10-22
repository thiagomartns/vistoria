// `pnpm screens <rota…> [--session] [--publish] [--out dir]`
// Tira prints do static export (`apps/web/out`) no celular e no desktop, nos tamanhos dos frames do Figma.
// Com --session, entra pelo /login (signin respondido aqui, sem API) e tira o print da rota do shell já logado:
// o banco local do usuário de mentira começa vazio. Com --publish, grava os PNGs na branch órfã `screens` e imprime
// a tabela para o corpo do PR.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

import { chromium } from "playwright-core";

import {
  SCREENS_BRANCH,
  VIEWPORTS,
  candidateFiles,
  markdownTable,
  parseArgs,
  publishPath,
  rawUrl,
  screenshotName,
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "apps/web/out");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serve() {
  const server = createServer((req, res) => {
    const file = candidateFiles(req.url ?? "/")
      .map((candidate) => join(outDir, candidate))
      .find((path) => path.startsWith(outDir) && existsSync(path) && statSync(path).isFile());
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    // Sem Google Chrome: Chromium do cache do Playwright (`pnpm --filter screens exec playwright-core install chromium`).
    return chromium.launch();
  }
}

// O signin da API, respondido pelo roteiro; o resto de /api/ fica sem resposta (o print não espera o sync).
const SESSION_USER = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Thiago Martins" };

async function signIn(page, base, route) {
  await page.route("**/api/v1/auth/signin", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "token-dos-prints",
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        user: SESSION_USER,
      }),
    }),
  );
  await page.goto(`${base}/login?next=${encodeURIComponent(route)}`);
  await page.getByLabel("E-mail").fill("prints@exemplo.com");
  await page.getByLabel("Senha").fill("senha-dos-prints");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => url.pathname + url.search === route);
  await page.waitForLoadState("networkidle");
}

async function capture(routes, dir, { session }) {
  if (!existsSync(join(outDir, "index.html"))) {
    throw new Error("apps/web/out não existe: rode `pnpm --filter web build` antes.");
  }
  mkdirSync(dir, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  const files = [];
  try {
    for (const route of routes) {
      for (const viewport of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        if (session) {
          await signIn(page, base, route);
        } else {
          const response = await page.goto(base + route, { waitUntil: "networkidle" });
          if (!response?.ok()) throw new Error(`${route} respondeu ${response?.status()}`);
        }
        await page.evaluate(() => document.fonts.ready);
        const path = join(dir, screenshotName(route, viewport.name));
        await page.screenshot({ path, fullPage: true });
        await page.close();
        files.push({ route, viewport: viewport.name, path });
        console.log(`✓ ${route} · ${viewport.name} → ${path}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return files;
}

function gh(args, body) {
  return execFileSync("gh", ["api", ...args, ...(body ? ["--input", "-"] : [])], {
    input: body ? JSON.stringify(body) : undefined,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function tryGh(args) {
  try {
    return JSON.parse(gh(args));
  } catch {
    return undefined;
  }
}

function ensureScreensBranch(repo) {
  if (tryGh([`repos/${repo}/git/ref/heads/${SCREENS_BRANCH}`])) return;
  const readme = "Prints dos PRs, gerados por `pnpm screens --publish`. Uma pasta por branch. Nunca entra na `main`.\n";
  const tree = JSON.parse(
    gh(["-X", "POST", `repos/${repo}/git/trees`], {
      tree: [{ path: "README.md", mode: "100644", type: "blob", content: readme }],
    }),
  );
  const commit = JSON.parse(
    gh(["-X", "POST", `repos/${repo}/git/commits`], {
      message: "chore: branch órfã dos prints",
      tree: tree.sha,
      parents: [],
    }),
  );
  gh(["-X", "POST", `repos/${repo}/git/refs`], { ref: `refs/heads/${SCREENS_BRANCH}`, sha: commit.sha });
  console.log(`✓ branch ${SCREENS_BRANCH} criada`);
}

function publish(files) {
  const repo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    encoding: "utf8",
  }).trim();
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  if (["main", "HEAD", SCREENS_BRANCH].includes(branch)) {
    throw new Error(`Publique a partir da branch da issue, não de ${branch}.`);
  }
  ensureScreensBranch(repo);

  const rows = new Map();
  for (const { route, viewport, path } of files) {
    const target = publishPath(branch, screenshotName(route, viewport));
    const api = `repos/${repo}/contents/${target.split("/").map(encodeURIComponent).join("/")}`;
    const existing = tryGh([`${api}?ref=${SCREENS_BRANCH}`]);
    gh(["-X", "PUT", api], {
      message: `chore: prints de ${branch}`,
      content: readFileSync(path).toString("base64"),
      branch: SCREENS_BRANCH,
      ...(existing?.sha ? { sha: existing.sha } : {}),
    });
    const row = rows.get(route) ?? { route, urls: {} };
    row.urls[viewport] = rawUrl(repo, target);
    rows.set(route, row);
  }
  console.log(`\n${markdownTable([...rows.values()])}`);
}

const { routes, publish: shouldPublish, session, out } = parseArgs(process.argv.slice(2));
const files = await capture(routes, resolve(process.env.INIT_CWD ?? root, out), { session });
if (shouldPublish) publish(files);
