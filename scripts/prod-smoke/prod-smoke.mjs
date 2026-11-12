// `pnpm smoke:prod`
// Roteiro curto contra o docker-compose de produção (#177): o app abre, entra e sincroniza pelo Caddy, na mesma origem,
// com TLS. Exige `pnpm prod:init` e `pnpm prod:up`. APP_URL troca a origem (padrão: https://localhost, com o
// certificado da CA interna do Caddy, que o navegador do roteiro aceita sem instalar).
// Os IPs forjados do passo 5 são da faixa de documentação (RFC 5737): nenhum IP real aparece aqui.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { chromium } from "playwright-core";

const base = (process.env.APP_URL ?? "https://localhost").replace(/\/$/, "");
const contextOptions = { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } };

const step = (n, text) => console.log(`\n${n}. ${text}`);
const ok = (text) => console.log(`   ✓ ${text}`);

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    // Sem Google Chrome: Chromium do cache do Playwright (`pnpm --filter prod-smoke exec playwright-core install chromium`).
    return chromium.launch();
  }
}

const synced = (page) => page.getByRole("button", { name: /^Pendências: Sincronizado/ }).waitFor({ timeout: 15_000 });

const user = {
  name: "Roteiro de produção",
  email: `prod-${Date.now()}-${randomBytes(3).toString("hex")}@exemplo.com`,
  password: randomBytes(18).toString("base64url"),
};
const clientName = `Cliente de produção ${randomBytes(2).toString("hex")}`;

const browser = await launch();
try {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  step(1, "Sem sessão, o static export servido pelo Caddy manda para o /login");
  await page.goto(`${base}/inspections`);
  await page.waitForURL(/\/login\?next=%2Finspections$/);
  ok(`${base}/inspections → /login`);

  step(2, "Cria a conta pelo /signup: a API responde na mesma origem");
  await page.goto(`${base}/signup`);
  await page.getByLabel("Nome").fill(user.name);
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  const signUp = page.waitForResponse((res) => res.url() === `${base}/api/v1/auth/signup`);
  await page.getByRole("button", { name: "Criar conta" }).click();
  assert.equal((await signUp).status(), 201, "o signup pelo proxy");
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"));
  ok("conta criada e sessão aberta");

  step(3, "Cria um cliente pela tela: o PUT passa pelo proxy e a fila esvazia");
  await page.goto(`${base}/clients`);
  await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  await page.getByRole("link", { name: "Novo cliente" }).first().click();
  await page.getByRole("heading", { level: 1, name: "Novo cliente" }).waitFor();
  await page.getByLabel("Nome").fill(clientName);
  const put = page.waitForResponse((res) => res.url().startsWith(`${base}/api/v1/clients/`) && res.request().method() === "PUT");
  await page.getByRole("button", { name: "Salvar" }).click();
  assert.equal((await put).status(), 201, "o PUT do cliente pelo proxy");
  await synced(page);
  const link = page.getByRole("table").getByRole("link", { name: clientName, exact: true });
  const id = new URL(await link.getAttribute("href"), base).searchParams.get("id");
  ok(`cliente ${id} no servidor; SyncStatus sincronizado`);

  step(4, "Recarrega: o access token some e a sessão volta pelo cookie do refresh (Secure, SameSite=Strict)");
  const refresh = page.waitForResponse((res) => res.url() === `${base}/api/v1/auth/refresh`);
  await page.reload();
  assert.equal((await refresh).status(), 200, "o refresh pelo cookie, na mesma origem");
  await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  await synced(page);
  assert.ok(!page.url().includes("/login"), "a sessão não pediu login de novo");
  ok("sessão renovada pelo cookie, sem login");

  step(5, "Um aparelho novo entra, baixa o cliente pelo pull e abre /clients/edit?id= (try_files do Caddy)");
  const other = await browser.newContext(contextOptions);
  const document = await other.request.get(`${base}/clients/edit?id=${id}`);
  assert.equal(document.status(), 200);
  assert.match(document.headers()["content-type"] ?? "", /^text\/html/);
  const fresh = await other.newPage();
  await fresh.goto(`${base}/login?next=${encodeURIComponent("/clients")}`);
  await fresh.getByLabel("E-mail").fill(user.email);
  await fresh.getByLabel("Senha").fill(user.password);
  await fresh.getByRole("button", { name: "Entrar" }).click();
  await fresh.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  await fresh.getByRole("table").getByRole("link", { name: clientName, exact: true }).click();
  await fresh.waitForURL(`${base}/clients/edit?id=${id}`);
  await fresh.getByRole("heading", { level: 1, name: clientName }).waitFor();
  assert.equal(await fresh.getByLabel("Nome").inputValue(), clientName);
  ok("o cliente chegou pelo pull e a rota com ?id= abriu");

  step(6, "Por último: X-Forwarded-For forjado não escapa do rate limit (o Caddy o descarta)");
  // O signin aceita 5 por minuto por IP; o passo 5 já gastou 1. Cada tentativa forja um IP diferente: se a API
  // confiasse no cabeçalho do cliente, nenhuma chegaria ao 429.
  let limitedAt = 0;
  for (let i = 1; i <= 6 && limitedAt === 0; i++) {
    const res = await other.request.post(`${base}/api/v1/auth/signin`, {
      headers: { "X-Forwarded-For": `203.0.113.${i}` },
      data: {},
    });
    if (res.status() === 429) limitedAt = i;
    else assert.equal(res.status(), 400, `signin vazio ${i}`);
  }
  assert.ok(limitedAt > 0, "o signin com X-Forwarded-For forjado precisa cair no limite");
  ok(`429 na tentativa ${limitedAt}, com um IP forjado diferente em cada uma`);

  console.log("\nCompose de produção: o app abre, entra e sincroniza pelo Caddy, na mesma origem.");
} finally {
  await browser.close();
}
