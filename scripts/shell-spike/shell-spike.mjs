// `pnpm spike:shell`
// Roteiro do spike 4 (#71, ADR 0032): depois da primeira visita, o static export abre em modo avião, inclusive
// numa rota com `?id=`. Exige `pnpm --filter web build`. Roda no CI, depois do static export.
// Serve `apps/web/out` como o Caddy em produção (`/rota` → `rota.html`). Com a rede desligada, cada página
// precisa vir do service worker (`response.fromServiceWorker()`).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

import { chromium } from "playwright-core";

import { candidateFiles } from "../screens/lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "apps/web/out");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
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
    // Sem Google Chrome: Chromium do cache do Playwright (`pnpm --filter shell-spike exec playwright-core install chromium`).
    return chromium.launch();
  }
}

const step = (n, text) => console.log(`\n${n}. ${text}`);
const ok = (text) => console.log(`   ✓ ${text}`);

/** Abre a rota e espera o header do shell com o título. Devolve a resposta do documento. */
async function openShell(page, url, title) {
  const response = await page.goto(url);
  await page.getByRole("heading", { level: 1, name: title }).waitFor({ timeout: 10_000 });
  return response;
}

const fromServiceWorker = (response, route) =>
  assert.ok(response?.fromServiceWorker(), `${route} não veio do service worker`);

if (!existsSync(join(outDir, "sw.js"))) {
  throw new Error("apps/web/out/sw.js não existe: rode `pnpm --filter web build` antes.");
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
try {
  // Desktop: o SyncStatus completo ("Offline") e a sidebar aparecem.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  step(1, "Primeira visita, com rede");
  await openShell(page, `${base}/inspections`, "Vistorias");
  const precached = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    let count = 0;
    for (const key of keys) count += (await (await caches.open(key)).keys()).length;
    return { active: registration.active?.state, count };
  });
  assert.equal(precached.active, "activated", "o service worker precisa estar ativo");
  assert.ok(precached.count > 0, "o pré-cache está vazio");
  ok(`service worker ativo, ${precached.count} arquivos no pré-cache`);

  step(2, "Modo avião: recarregar o shell");
  await context.setOffline(true);
  fromServiceWorker(await page.reload(), "/inspections");
  await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor({ timeout: 10_000 });
  ok("/inspections abriu, servido pelo service worker");
  await page.getByText("Você está offline").waitFor();
  await page.getByRole("button", { name: /^Pendências: Offline/ }).waitFor();
  ok("OfflineBanner e SyncStatus mostram offline");

  step(3, "Modo avião: rota com ?id= e outra rota");
  const id = randomUUID();
  fromServiceWorker(await openShell(page, `${base}/clients/edit?id=${id}`, "Clientes"), "/clients/edit");
  await page.getByText(`Cliente ${id}`).waitFor();
  ok(`/clients/edit?id=${id} abriu com o id`);
  fromServiceWorker(await openShell(page, `${base}/properties`, "Imóveis"), "/properties");
  ok("/properties abriu");
  await page.getByRole("link", { name: "Roteiros" }).click();
  await page.getByRole("heading", { level: 1, name: "Roteiros" }).waitFor();
  ok("navegação pela sidebar funciona offline");

  step(4, "Rede de volta");
  await context.setOffline(false);
  await page.getByRole("button", { name: /^Pendências: Sincronizado/ }).waitFor();
  assert.equal(await page.getByText("Você está offline").count(), 0);
  ok("o banner some e o SyncStatus volta a sincronizado");

  console.log("\nSpike 4: o shell abre offline depois da primeira visita.");
} finally {
  await browser.close();
  server.close();
}
