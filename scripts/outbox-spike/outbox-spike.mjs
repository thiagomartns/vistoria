// `pnpm spike:outbox`
// Roteiro do spike 1a (#59, ADR 0030): a outbox do TanStack DB contra a API real, no static export.
// Exige `pnpm db:up`, `pnpm dev:api` (http://localhost:8080) e `pnpm --filter web build`.
// Serve `apps/web/out` com `/api/*` repassado para a API, na mesma origem, como o Caddy em produção.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { extname, join, resolve } from "node:path";

import { chromium } from "playwright-core";

import { candidateFiles } from "../screens/lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "apps/web/out");
const api = new URL(process.env.API_URL ?? "http://localhost:8080");
const route = "/spike-outbox";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serve() {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/")) {
      const upstream = request(
        { host: api.hostname, port: api.port, path: req.url, method: req.method, headers: req.headers },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on("error", () => res.writeHead(502).end());
      req.pipe(upstream);
      return;
    }
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
    return chromium.launch();
  }
}

async function callApi(path, init = {}) {
  const response = await fetch(new URL(path, api), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// Senha gerada na hora e nunca impressa (ADR 0025).
async function signUp() {
  const user = {
    name: "Roteiro do spike 1a",
    email: `spike-${Date.now()}@exemplo.com`,
    password: randomBytes(18).toString("base64url"),
  };
  const { status, body } = await callApi("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(user) });
  assert.equal(status, 201, `signup respondeu ${status}`);
  return { ...user, token: body.accessToken };
}

async function serverClient(user, id) {
  return callApi(`/api/v1/clients/${id}`, { headers: { authorization: `Bearer ${user.token}` } });
}

/** Todo PUT de client que a página dispara, com o que interessa ao roteiro. */
function watchPuts(page) {
  const puts = [];
  page.on("request", (req) => {
    if (req.method() !== "PUT" || !req.url().includes("/api/v1/clients/")) return;
    const entry = {
      at: Date.now(),
      id: req.url().split("/").pop(),
      key: req.headers()["idempotency-key"],
      auth: req.headers()["authorization"],
      body: req.postData(),
      status: null,
    };
    puts.push(entry);
    req.response().then(
      (res) => (entry.status = res?.status() ?? "sem resposta"),
      () => (entry.status = "falhou"),
    );
  });
  page.on("requestfailed", (req) => {
    const entry = puts.findLast((put) => req.url().endsWith(put.id) && put.status === null);
    if (entry) entry.status = "falhou";
  });
  return puts;
}

async function signIn(page, user) {
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByTestId("session").waitFor();
}

async function saveName(page, name, { edit } = {}) {
  if (edit) await page.getByTestId("client").getByRole("button", { name: "Editar" }).first().click();
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("button", { name: edit ? "Salvar" : "Criar" }).click();
}

const keysOnScreen = (page) => page.getByTestId("outbox-key").allTextContents();
const outboxCount = async (page) => Number(await page.getByTestId("outbox-count").textContent());

async function until(check, what, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

/** Espera um envio a partir de `from` terminar com `status` e a outbox esvaziar. */
const settled = (page, puts, from, status, what) =>
  until(
    async () => puts.slice(from).some((put) => put.status === status) && (await outboxCount(page)) === 0,
    what,
    90_000,
  );

const step = (n, text) => console.log(`\n${n}. ${text}`);
const ok = (text) => console.log(`   ✓ ${text}`);

if (!existsSync(join(outDir, "index.html"))) {
  throw new Error("apps/web/out não existe: rode `pnpm --filter web build` antes.");
}
const health = await callApi("/api/v1/health").catch(() => ({ status: 0 }));
assert.equal(health.status, 200, `API fora do ar em ${api}: rode \`pnpm dev:api\`.`);

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const puts = watchPuts(page);
  const user = await signUp();

  step(1, "Entrar com um usuário novo");
  await page.goto(base + route);
  await signIn(page, user);
  ok(`sessão ativa (${user.email})`);

  step(2, "Offline: criar e editar um client");
  await context.setOffline(true);
  await saveName(page, "Imobiliária Alfa");
  await page.getByTestId("client-name").getByText("Imobiliária Alfa", { exact: true }).waitFor({ timeout: 1000 });
  ok("criado: o nome aparece na hora (otimista)");
  await saveName(page, "Imobiliária Alfa Ltda", { edit: true });
  await page.getByTestId("client-name").getByText("Imobiliária Alfa Ltda").waitFor({ timeout: 1000 });
  ok("editado: o nome novo aparece na hora");
  const id = await page.getByTestId("client").getAttribute("data-id");
  await until(async () => (await outboxCount(page)) === 2, "duas transações na outbox");
  const keys = await keysOnScreen(page);
  assert.equal(new Set(keys).size, 2);
  ok(`2 transações pendentes, chaves ${keys.join(", ")}`);
  assert.equal((await serverClient(user, id)).status, 404, "o client não pode estar no servidor ainda");
  ok("o servidor ainda não conhece o client");

  step(3, "Recarregar sem acesso à API");
  // Sem service worker (spike 4), o shell não abre com o contexto offline: a API fica bloqueada pelo route.
  await context.route("**/api/**", (r) => r.abort("internetdisconnected"));
  await context.setOffline(false);
  await page.reload();
  await page.getByTestId("client-name").getByText("Imobiliária Alfa Ltda").waitFor();
  await until(async () => (await outboxCount(page)) === 2, "outbox restaurada");
  assert.deepEqual(await keysOnScreen(page), keys);
  ok("o registro e as 2 transações continuam, com as mesmas chaves");

  step(4, "Voltar a rede e entrar de novo");
  await context.unroute("**/api/**");
  const before = puts.length;
  await signIn(page, user);
  await until(async () => (await outboxCount(page)) === 0, "outbox vazia", 90_000);
  const sent = puts.slice(before).filter((put) => put.status === 200 || put.status === 201);
  assert.deepEqual(
    sent.map((put) => put.key),
    keys,
    "cada transação sai uma vez com sucesso, na ordem, com a sua chave",
  );
  for (const put of sent) {
    assert.equal(put.id, id);
    assert.match(put.auth ?? "", /^Bearer .+/);
  }
  ok(`PUT /api/v1/clients/${id} com Authorization e Idempotency-Key (${sent.map((p) => p.status).join(", ")})`);
  const saved = await serverClient(user, id);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.name, "Imobiliária Alfa Ltda");
  ok(`getClient confirma no SQL Server: "${saved.body.name}" (version ${saved.body.version})`);

  step(5, "Derrubar a resposta depois de o servidor processar");
  let dropped = 0;
  await context.route("**/api/v1/clients/*", async (r) => {
    if (r.request().method() !== "PUT" || dropped > 0) return r.fallback();
    dropped++;
    const answer = await r.fetch();
    console.log(`   · servidor respondeu ${answer.status()}; a resposta não chega à página`);
    return r.abort("connectionreset");
  });
  const fromDrop = puts.length;
  await saveName(page, "Alfa Imóveis", { edit: true });
  await settled(page, puts, fromDrop, 200, "reenvio confirmado");
  await context.unroute("**/api/v1/clients/*");
  const attempts = puts.slice(fromDrop);
  assert.ok(attempts.length >= 2, `esperava reenvio, houve ${attempts.length} envio(s)`);
  assert.equal(new Set(attempts.map((put) => put.key)).size, 1, "a mesma chave em todo envio");
  assert.equal(new Set(attempts.map((put) => put.body)).size, 1, "o mesmo corpo em todo envio");
  ok(`${attempts.length} envios com a mesma chave ${attempts[0].key} e o mesmo corpo`);
  const after = await serverClient(user, id);
  assert.equal(after.body.name, "Alfa Imóveis");
  ok(`um client só no servidor (id ${id}), "${after.body.name}", version ${after.body.version}`);

  step(6, "Grupos de falha: retry tenta de novo; outro grupo não entra em laço");
  const problem = (type, status, title) =>
    JSON.stringify({ type: `urn:vistoria:problem:${type}`, title, status, detail: title, traceId: "roteiro" });
  let internal = 0;
  await context.route("**/api/v1/clients/*", (r) => {
    if (r.request().method() !== "PUT" || internal++ > 0) return r.fallback();
    return r.fulfill({ status: 500, contentType: "application/problem+json", body: problem("internal", 500, "Erro") });
  });
  const fromInternal = puts.length;
  await saveName(page, "Alfa Imóveis S/A", { edit: true });
  await settled(page, puts, fromInternal, 200, "retry depois do 500");
  await context.unroute("**/api/v1/clients/*");
  const retried = puts.slice(fromInternal);
  assert.equal(retried.length, 2);
  assert.equal(retried[0].key, retried[1].key);
  ok(`500 internal → nova tentativa ${retried[1].at - retried[0].at} ms depois, com a mesma chave`);

  await context.route("**/api/v1/clients/*", (r) =>
    r.request().method() === "PUT"
      ? r.fulfill({ status: 400, contentType: "application/problem+json", body: problem("validation", 400, "Inválido") })
      : r.fallback(),
  );
  const fromValidation = puts.length;
  await saveName(page, "Nome recusado", { edit: true });
  await settled(page, puts, fromValidation, 400, "transação recusada sai da fila");
  await new Promise((done) => setTimeout(done, 5000));
  await context.unroute("**/api/v1/clients/*");
  assert.equal(puts.length - fromValidation, 1, "validation não pode ser reenviado");
  await page.getByTestId("client-name").getByText("Alfa Imóveis S/A").waitFor();
  ok("400 validation → 1 envio em 5 s, a transação sai da fila e o otimista é desfeito");

  console.log("\nRoteiro concluído.");
} finally {
  await browser.close();
  server.close();
}
