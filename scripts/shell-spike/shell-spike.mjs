// `pnpm spike:shell`
// Roteiro do spike 4 (#71, ADR 0032): depois da primeira visita, o static export abre em modo avião, inclusive
// numa rota com `?id=`. Exige `pnpm --filter web build`. Roda no CI, depois do static export.
// Serve `apps/web/out` como o Caddy em produção (`/rota` → `rota.html`). Com a rede desligada, cada página
// precisa vir do service worker (`response.fromServiceWorker()`).
// Desde o #72 o shell exige sessão: o roteiro entra pelo /login com o signin respondido aqui (sem API no CI) e, ao
// voltar a rede depois do reload, confere que a sessão expirada pede login de novo. Desde o #132 a volta da rede tenta
// renovar pelo cookie; o roteiro não tem cookie, e o refresh respondido aqui é recusado (401 unauthorized).
// Desde o #73 o passo 3 cria um cliente offline pela tela e reabre /clients/edit?id= pelo service worker; o PUT
// dele também é respondido aqui, para a fila esvaziar depois do login.

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

const user = { id: randomUUID(), name: "Roteiro do spike 4" };

/** O signin e o PUT de client da API, respondidos pelo roteiro: o CI não tem API. */
async function fakeApi(context) {
  await context.route("**/api/v1/auth/signin", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "token-do-roteiro",
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        user,
      }),
    }),
  );
  await context.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "urn:vistoria:problem:unauthorized",
        title: "Não autenticado",
        status: 401,
        detail: "Sem refresh token.",
        traceId: "00-roteiro",
      }),
    }),
  );
  await context.route("**/api/v1/clients/*", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const now = new Date().toISOString();
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id,
        ...JSON.parse(route.request().postData() ?? "{}"),
        version: "AAAAAAAAB9M=",
        createdAt: now,
        updatedAt: now,
      }),
    });
  });
}

async function signIn(page) {
  await page.getByLabel("E-mail").fill("roteiro@exemplo.com");
  await page.getByLabel("Senha").fill("senha-do-roteiro");
  await page.getByRole("button", { name: "Entrar" }).click();
}

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

  await fakeApi(context);

  step(1, "Primeira visita, com rede: o shell manda para o /login");
  await page.goto(`${base}/inspections`);
  await page.waitForURL(/\/login\?next=%2Finspections$/);
  await signIn(page);
  await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor({ timeout: 10_000 });
  ok("entrou e voltou para /inspections");
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

  step(2, "Modo avião: recarregar o shell (o token some, o dono fica)");
  await context.setOffline(true);
  fromServiceWorker(await page.reload(), "/inspections");
  await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor({ timeout: 10_000 });
  ok("/inspections abriu, servido pelo service worker, sem mandar para o /login");
  await page.getByText("Você está offline").waitFor();
  await page.getByRole("button", { name: /^Pendências: Offline/ }).waitFor();
  await page.getByText(user.name).waitFor();
  ok("OfflineBanner e SyncStatus mostram offline; o menu mostra o dono");

  step(3, "Modo avião: criar um cliente, abrir a rota com ?id= e outra rota");
  fromServiceWorker(await openShell(page, `${base}/clients`, "Clientes"), "/clients");
  await page.getByRole("link", { name: "Novo cliente" }).first().click();
  await page.getByRole("heading", { level: 1, name: "Novo cliente" }).waitFor();
  await page.getByLabel("Nome").fill("Cliente do roteiro");
  await page.getByRole("button", { name: "Salvar" }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Cliente do roteiro" }) });
  await row.getByText("Salvo no aparelho").waitFor({ timeout: 2000 });
  ok("criado offline: a linha aparece na hora, com \"Salvo no aparelho\"");
  const id = new URL(await row.getByRole("link").getAttribute("href"), base).searchParams.get("id");
  fromServiceWorker(
    await openShell(page, `${base}/clients/edit?id=${id}`, "Cliente do roteiro"),
    "/clients/edit",
  );
  assert.equal(await page.getByLabel("Nome").inputValue(), "Cliente do roteiro");
  ok(`/clients/edit?id=${id} abriu com o cliente do banco local`);
  fromServiceWorker(await openShell(page, `${base}/properties`, "Imóveis"), "/properties");
  ok("/properties abriu");
  await page.getByRole("link", { name: "Roteiros" }).click();
  await page.getByRole("heading", { level: 1, name: "Roteiros" }).waitFor();
  ok("navegação pela sidebar funciona offline");

  step(4, "Rede de volta: a sessão expirada pede login");
  await context.setOffline(false);
  await page.waitForURL(/\/login\?next=%2Ftemplates$/);
  await page.getByText("Sua sessão expirou").waitFor();
  await page.getByText("Entre novamente para enviar a alteração salva neste aparelho.").waitFor();
  ok("/login com SessionExpired (com a pendência do cliente criado offline)");
  await signIn(page);
  await page.getByRole("heading", { level: 1, name: "Roteiros" }).waitFor();
  await page.getByRole("button", { name: /^Pendências: Sincronizado/ }).waitFor();
  assert.equal(await page.getByText("Você está offline").count(), 0);
  ok("entrou de novo, voltou para /templates, o cliente saiu e o SyncStatus está sincronizado");

  console.log("\nSpike 4: o shell abre offline depois da primeira visita.");
} finally {
  await browser.close();
  server.close();
}
