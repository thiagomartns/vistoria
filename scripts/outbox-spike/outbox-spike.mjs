// `pnpm spike:outbox`
// Roteiro do spike 1a (#59, ADR 0030): a outbox do TanStack DB contra a API real, no static export.
// Exige `pnpm db:up`, `pnpm dev:api` (http://localhost:8080) e `pnpm --filter web build`.
// Serve `apps/web/out` com `/api/*` repassado para a API, na mesma origem, como o Caddy em produção.
// Desde o #72 entra pelo /login: recarregar perde o token, a fila espera, e só o login do mesmo usuário a envia.
// Desde o #69 a API exige If-Match para editar, e a outbox só o envia no spike 1b (#60): até lá o roteiro só cria
// clients (um PUT sem If-Match por registro).

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
async function signUp(name) {
  const user = {
    name,
    email: `spike-${Date.now()}-${randomBytes(3).toString("hex")}@exemplo.com`,
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

/** Entra pelo /login e volta para a página de prova pelo `?next=`, sem recarregar (o token fica na memória). */
async function signIn(page, user, { expired } = {}) {
  await page.goto(`${base}/login?next=${encodeURIComponent(route)}`);
  if (expired) await page.getByText("Sua sessão expirou").waitFor();
  const notice = expired ? await page.getByRole("status").first().textContent() : null;
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByTestId("session").getByText(user.name).waitFor();
  return notice;
}

/** Cria um client pela página e devolve o id gerado no aparelho. */
async function create(page, name) {
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("button", { name: "Criar" }).click();
  const row = page.getByTestId("client").filter({ has: page.getByText(name, { exact: true }) });
  await row.waitFor({ timeout: 1000 });
  return row.getAttribute("data-id");
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
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const browser = await launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const puts = watchPuts(page);
  const user = await signUp("Ana do roteiro");
  const other = await signUp("Bia do roteiro");

  step(1, "Entrar pelo /login com um usuário novo");
  await signIn(page, user);
  ok(`sessão ativa (${user.email}), de volta em ${route}`);
  // O reload offline do passo 3 vem do service worker (spike 4): ele precisa estar ativo antes.
  await page.evaluate(() => navigator.serviceWorker.ready);
  ok("service worker ativo");

  step(2, "Offline: criar dois clients");
  await context.setOffline(true);
  const alfa = await create(page, "Imobiliária Alfa");
  const beta = await create(page, "Imobiliária Beta");
  ok("criados: os nomes aparecem na hora (otimista)");
  await until(async () => (await outboxCount(page)) === 2, "duas transações na outbox");
  const keys = await keysOnScreen(page);
  assert.equal(new Set(keys).size, 2);
  ok(`2 transações pendentes, chaves ${keys.join(", ")}`);
  assert.equal((await serverClient(user, alfa)).status, 404, "o client não pode estar no servidor ainda");
  ok("o servidor ainda não conhece os clients");

  step(3, "Modo avião: recarregar");
  await page.reload();
  await page.getByTestId("client-name").getByText("Imobiliária Beta").waitFor();
  await until(async () => (await outboxCount(page)) === 2, "outbox restaurada");
  assert.deepEqual(await keysOnScreen(page), keys);
  await page.getByTestId("no-session").getByText("Sessão expirada").waitFor();
  ok("os registros e as 2 transações continuam, com as mesmas chaves; a sessão expirou");

  step(4, "Voltar a rede: a fila espera o login; SessionExpired; entrar envia");
  const before = puts.length;
  await context.setOffline(false);
  await wait(3000);
  assert.equal(puts.length, before, "sem token, a fila não pode sair");
  ok("3 s com rede e sem token: nenhum PUT");
  const notice = await signIn(page, user, { expired: true });
  assert.match(notice ?? "", /enviar as 2 alterações salvas neste aparelho/);
  ok(`/login mostrou: "${notice}"`);
  await until(async () => (await outboxCount(page)) === 0, "outbox vazia", 90_000);
  const sent = puts.slice(before).filter((put) => put.status === 201);
  assert.deepEqual(
    sent.map((put) => put.key),
    keys,
    "cada transação sai uma vez com sucesso, na ordem, com a sua chave",
  );
  assert.deepEqual(sent.map((put) => put.id), [alfa, beta]);
  for (const put of sent) assert.match(put.auth ?? "", /^Bearer .+/);
  ok(`2 PUT /api/v1/clients/{id} com Authorization e Idempotency-Key (${sent.map((p) => p.status).join(", ")})`);
  for (const [id, name] of [[alfa, "Imobiliária Alfa"], [beta, "Imobiliária Beta"]]) {
    const saved = await serverClient(user, id);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.name, name);
  }
  ok("getClient confirma os dois no SQL Server");

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
  const gama = await create(page, "Gama Imóveis");
  await settled(page, puts, fromDrop, 201, "reenvio confirmado");
  await context.unroute("**/api/v1/clients/*");
  const attempts = puts.slice(fromDrop);
  assert.ok(attempts.length >= 2, `esperava reenvio, houve ${attempts.length} envio(s)`);
  assert.equal(new Set(attempts.map((put) => put.key)).size, 1, "a mesma chave em todo envio");
  assert.equal(new Set(attempts.map((put) => put.body)).size, 1, "o mesmo corpo em todo envio");
  ok(`${attempts.length} envios com a mesma chave ${attempts[0].key} e o mesmo corpo`);
  const after = await serverClient(user, gama);
  assert.equal(after.body.name, "Gama Imóveis");
  ok(`um client só no servidor (id ${gama}), version ${after.body.version}`);

  step(6, "Grupos de falha: retry tenta de novo; outro grupo não entra em laço");
  const problem = (type, status, title) =>
    JSON.stringify({ type: `urn:vistoria:problem:${type}`, title, status, detail: title, traceId: "roteiro" });
  let internal = 0;
  await context.route("**/api/v1/clients/*", (r) => {
    if (r.request().method() !== "PUT" || internal++ > 0) return r.fallback();
    return r.fulfill({ status: 500, contentType: "application/problem+json", body: problem("internal", 500, "Erro") });
  });
  const fromInternal = puts.length;
  await create(page, "Delta Imóveis");
  await settled(page, puts, fromInternal, 201, "retry depois do 500");
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
  await create(page, "Nome recusado");
  await settled(page, puts, fromValidation, 400, "transação recusada sai da fila");
  await wait(5000);
  await context.unroute("**/api/v1/clients/*");
  assert.equal(puts.length - fromValidation, 1, "validation não pode ser reenviado");
  await until(async () => (await page.getByText("Nome recusado", { exact: true }).count()) === 0, "otimista desfeito");
  ok("400 validation → 1 envio em 5 s, a transação sai da fila e o otimista é desfeito");

  step(7, "Outro usuário entra: a fila do anterior não sai com a conta dele");
  // Com a página controlada pelo service worker, o modo avião do Playwright não barra o fetch que passa por ele;
  // aqui a pendência nasce com a sessão expirada (recarregou), e a fila espera pelo token.
  await page.reload();
  await page.getByTestId("no-session").getByText("Sessão expirada").waitFor();
  const fromPending = puts.length;
  const pending = await create(page, "Pendência da Ana");
  await until(async () => (await outboxCount(page)) === 1, "uma pendência da Ana");
  await wait(2000);
  assert.equal(puts.length, fromPending, "sem token, a pendência não sai");
  ok("sessão expirada: a pendência fica na fila");
  const fromOther = puts.length;
  await signIn(page, other, { expired: true });
  await until(async () => (await outboxCount(page)) === 0, "a outbox da Bia, vazia");
  assert.equal(await page.getByTestId("client").count(), 0, "o banco da Bia não tem os clients da Ana");
  await wait(5000);
  assert.equal(puts.length - fromOther, 0, "nenhum PUT da fila da Ana com a sessão da Bia");
  assert.equal((await serverClient(user, pending)).status, 404);
  ok("a Bia vê o banco dela, vazio; em 5 s nenhum PUT, e o servidor não recebeu a pendência");
  await page.reload();
  await signIn(page, user, { expired: true });
  await until(async () => (await outboxCount(page)) === 0, "a fila da Ana sai", 90_000);
  assert.equal((await serverClient(user, pending)).body.name, "Pendência da Ana");
  assert.equal((await serverClient(other, pending)).status, 404, "a pendência é da Ana, não da Bia");
  ok("a Ana entra de novo e a pendência dela chega ao servidor, na conta dela");

  console.log("\nRoteiro concluído.");
} finally {
  await browser.close();
  server.close();
}
