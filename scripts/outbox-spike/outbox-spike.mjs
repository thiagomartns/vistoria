// `pnpm spike:outbox`
// Roteiro dos spikes 1a (#59, ADR 0030) e 1b (#60): a outbox do TanStack DB contra a API real, no static export.
// Exige `pnpm db:up`, `pnpm dev:api` (http://localhost:8080) e `pnpm --filter web build`.
// Serve `apps/web/out` com `/api/*` repassado para a API, na mesma origem, como o Caddy em produção.
// Desde o #72 entra pelo /login: recarregar perde o token, a fila espera, e só o login do mesmo usuário a envia.
// Desde o #73 usa as telas de clientes (/clients e /clients/edit) no desktop, e a outbox envia If-Match na edição.
// A navegação entre as telas é pelo app (links), nunca por page.goto: recarregar perderia o token.
// Desde o #74 cria também um imóvel offline com um cliente ainda pendente: a fila é serial (ADR 0034), e o imóvel sai
// depois do cliente.
// Desde o #60 (spike 1b) começa no celular (a 1ª entrega do M2) e prova o contrato com o servidor: a resposta derrubada
// recebe a gravada sem subir a versão, duas edições seguidas saem encadeadas pelo If-Match, o 412 marca o conflito sem
// laço e o 409 idempotency-in-progress espera o Retry-After.

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
const route = "/clients";

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

/** Uma Idempotency-Key UUID v7, a única que a API aceita (o resto é 428). */
function uuidv7() {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  return { ...user, id: body.user.id, token: body.accessToken };
}

async function serverClient(user, id) {
  return callApi(`/api/v1/clients/${id}`, { headers: { authorization: `Bearer ${user.token}` } });
}

async function serverProperty(user, id) {
  return callApi(`/api/v1/properties/${id}`, { headers: { authorization: `Bearer ${user.token}` } });
}

/** Todo PUT de client e de imóvel que a página dispara, com o que interessa ao roteiro. */
function watchPuts(page) {
  const puts = [];
  page.on("request", (req) => {
    const entity = req.url().match(/\/api\/v1\/(clients|properties)\//)?.[1];
    if (req.method() !== "PUT" || !entity) return;
    const entry = {
      at: Date.now(),
      entity,
      id: req.url().split("/").pop(),
      key: req.headers()["idempotency-key"],
      ifMatch: req.headers()["if-match"],
      auth: req.headers()["authorization"],
      body: req.postData(),
      status: null,
    };
    puts.push(entry);
    req.response().then(
      (res) => {
        entry.etag = res?.headers()["etag"];
        entry.status = res?.status() ?? "sem resposta";
      },
      () => (entry.status = "falhou"),
    );
  });
  page.on("requestfailed", (req) => {
    const entry = puts.findLast((put) => req.url().endsWith(put.id) && put.status === null);
    if (entry) entry.status = "falhou";
  });
  return puts;
}

/** Entra pelo /login e volta para a lista de clientes pelo `?next=`, sem recarregar (o token fica na memória). */
async function signIn(page, user, { expired } = {}) {
  await page.goto(`${base}/login?next=${encodeURIComponent(route)}`);
  if (expired) await page.getByText("Sua sessão expirou").waitFor();
  const notice = expired ? await page.getByRole("status").first().textContent() : null;
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha").fill(user.password);
  // O roteiro entra 6 vezes, e o signin aceita 5 por minuto e IP: no 429, espera o Retry-After e entra de novo.
  for (;;) {
    const answer = page.waitForResponse((res) => res.url().endsWith("/api/v1/auth/signin"));
    await page.getByRole("button", { name: "Entrar" }).click();
    const res = await answer;
    if (res.status() !== 429) break;
    const seconds = Number(res.headers()["retry-after"] ?? 60);
    console.log(`   · signin 429 rate-limited: espera o Retry-After de ${seconds} s`);
    await wait(seconds * 1000);
  }
  await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  return notice;
}

/** Abaixo de `md` a Table vira lista de ListRow. */
const isMobile = (page) => page.viewportSize().width < 768;

/** A linha da lista com o título: a da Table no desktop, a ListRow (um link só) no celular. */
const rowOf = (page, name) =>
  isMobile(page)
    ? page.getByRole("list").getByRole("link").filter({ has: page.getByText(name, { exact: true }) })
    : page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

/** O link que abre o registro com o título, na lista. */
const linkOf = (page, name) =>
  isMobile(page) ? rowOf(page, name) : page.getByRole("table").getByRole("link", { name, exact: true });

const idOf = async (link) => new URL(await link.getAttribute("href"), base).searchParams.get("id");

/** Cria um client por /clients/edit, de volta na lista, e devolve o id gerado no aparelho. */
async function create(page, name) {
  await page.getByRole("link", { name: "Novo cliente" }).first().click();
  await page.getByRole("heading", { level: 1, name: "Novo cliente" }).waitFor();
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("button", { name: "Salvar" }).click();
  const link = linkOf(page, name);
  await link.waitFor({ timeout: 2000 });
  return idOf(link);
}

/** De /clients para /properties (ou o contrário) pela navegação do app. */
async function goTo(page, title) {
  await page.getByRole("navigation").getByRole("link", { name: title }).click();
  await page.getByRole("heading", { level: 1, name: title }).waitFor();
}

/** Vai de /clients a /properties e cria um imóvel do cliente `clientName` por /properties/edit; volta para /clients. */
async function createProperty(page, clientName, street) {
  await goTo(page, "Imóveis");
  await page.getByRole("link", { name: "Novo imóvel" }).first().click();
  await page.getByRole("heading", { level: 1, name: "Novo imóvel" }).waitFor();
  await page.getByLabel("Cliente").click();
  await page.getByRole("option", { name: clientName }).click();
  await page.getByLabel("Tipo").click();
  await page.getByRole("option", { name: "Apartamento" }).click();
  await page.getByLabel("CEP").fill("40010-000");
  await page.getByLabel("Rua").fill(street);
  await page.getByLabel("Número").fill("10");
  await page.getByLabel("Bairro").fill("Comércio");
  await page.getByLabel("Cidade").fill("Salvador");
  await page.getByLabel("UF").fill("ba");
  await page.getByRole("button", { name: "Salvar" }).click();
  const address = `${street}, 10`;
  const link = linkOf(page, address);
  await link.waitFor({ timeout: 2000 });
  await rowOf(page, address).getByText("Salvo no aparelho").waitFor();
  const id = await idOf(link);
  await goTo(page, "Clientes");
  return id;
}

/** Em /properties, abre o imóvel pelo endereço, troca as observações (fora do endereço) e salva; volta para a lista. */
async function editNotes(page, address, notes) {
  await linkOf(page, address).click();
  await page.getByRole("heading", { level: 1, name: address }).waitFor();
  await page.getByLabel("Observações").fill(notes);
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.getByRole("heading", { level: 1, name: "Imóveis" }).waitFor();
}

/** As chaves das transações na outbox do usuário, da mais antiga para a mais nova, lidas do IndexedDB dela. */
const outboxKeys = (page, user) =>
  page.evaluate(async (name) => {
    const request = (r) =>
      new Promise((done, fail) => {
        r.onsuccess = () => done(r.result);
        r.onerror = () => fail(r.error);
      });
    const db = await request(indexedDB.open(name));
    try {
      if (!db.objectStoreNames.contains("transactions")) return [];
      const rows = await request(db.transaction("transactions").objectStore("transactions").getAll());
      return rows
        .map((row) => JSON.parse(row))
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((transaction) => transaction.idempotencyKey);
    } finally {
      db.close();
    }
  }, `vistoria-outbox-${user.id}`);

const outboxCount = async (page, user) => (await outboxKeys(page, user)).length;

async function until(check, what, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

/** Espera um envio a partir de `from` terminar com `status` e a outbox de `user` esvaziar. */
const settled = (page, user, puts, from, status, what) =>
  until(
    async () =>
      puts.slice(from).some((put) => put.status === status) && (await outboxCount(page, user)) === 0,
    what,
    90_000,
  );

/** A `version` de um ETag forte (`"AAAAAAAAB9M="`). */
const versionOf = (etag) => etag?.replace(/^"|"$/g, "");

const succeeded = (put) => put.status === 200 || put.status === 201;

/** O corpo de um ProblemDetails do contrato, para os `route.fulfill`. */
const problem = (type, status, title, extra = {}) =>
  JSON.stringify({ type: `urn:vistoria:problem:${type}`, title, status, detail: title, traceId: "roteiro", ...extra });

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
  // Celular: a 1ª entrega do M2 (vision.md, "Marcos"). A lista é de ListRow, e a navegação, a BottomNav.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const mobile = await phone.newPage();
  const mobilePuts = watchPuts(mobile);
  const caio = await signUp("Caio do celular");

  step(1, "Celular: entrar, cadastrar cliente e imóvel offline, recarregar");
  await signIn(mobile, caio);
  await mobile.evaluate(() => navigator.serviceWorker.ready);
  ok(`sessão ativa (${caio.email}) a 390×844, service worker ativo`);
  // A página veio do /login sem recarregar e o SW ainda não a controla: offline, ir para /clients/edit depende do
  // prefetch do Next. Sem esperar a rede assentar, o modo avião às vezes corta o prefetch no meio.
  await mobile.waitForLoadState("networkidle");
  await phone.setOffline(true);
  const celular = await create(mobile, "Imobiliária Celular");
  await rowOf(mobile, "Imobiliária Celular").getByText("Salvo no aparelho").waitFor();
  const apto = await createProperty(mobile, "Imobiliária Celular", "Rua do Celular");
  await until(async () => (await outboxCount(mobile, caio)) === 2, "duas transações na outbox do celular");
  const mobileKeys = await outboxKeys(mobile, caio);
  ok("cliente e imóvel criados offline pela ListRow, com \"Salvo no aparelho\"");
  await mobile.reload();
  await rowOf(mobile, "Imobiliária Celular").getByText("Salvo no aparelho").waitFor();
  await until(async () => (await outboxCount(mobile, caio)) === 2, "outbox do celular restaurada");
  assert.deepEqual(await outboxKeys(mobile, caio), mobileKeys);
  ok("recarregado em modo avião: os dois continuam, com as mesmas chaves");

  step(2, "Celular: voltar a rede e entrar de novo; os dois chegam ao SQL Server uma vez só");
  await phone.setOffline(false);
  await mobile.waitForURL(/\/login\?next=%2Fclients$/);
  await signIn(mobile, caio, { expired: true });
  await until(async () => (await outboxCount(mobile, caio)) === 0, "outbox do celular vazia", 90_000);
  for (const key of mobileKeys) {
    const accepted = mobilePuts.filter((put) => put.key === key && succeeded(put));
    assert.equal(accepted.length, 1, `a chave ${key} tem de ser aceita uma vez só`);
  }
  const [clientPut, propertyPut] = mobileKeys.map((key) => mobilePuts.find((put) => put.key === key && succeeded(put)));
  assert.deepEqual([clientPut.id, propertyPut.id], [celular, apto]);
  const mobileClient = await serverClient(caio, celular);
  const mobileProperty = await serverProperty(caio, apto);
  assert.equal(mobileClient.body.name, "Imobiliária Celular");
  assert.equal(mobileProperty.body.clientId, celular);
  // Todo PUT aceito sobe a versão (ADR 0028): a do servidor ser a do 201 prova que nenhum outro foi aplicado.
  assert.equal(mobileClient.body.version, versionOf(clientPut.etag));
  assert.equal(mobileProperty.body.version, versionOf(propertyPut.etag));
  ok(`um 201 por chave, e o servidor na version do 201 (cliente ${mobileClient.body.version}, imóvel ${mobileProperty.body.version})`);
  await until(
    async () => (await rowOf(mobile, "Imobiliária Celular").getByText("Salvo no aparelho").count()) === 0,
    "badge do cliente some",
  );
  await rowOf(mobile, "Imobiliária Celular").waitFor();
  await goTo(mobile, "Imóveis");
  await rowOf(mobile, "Rua do Celular, 10").waitFor();
  await until(
    async () => (await rowOf(mobile, "Rua do Celular, 10").getByText("Salvo no aparelho").count()) === 0,
    "badge do imóvel some",
  );
  ok("os dois aparecem em /clients e /properties, sincronizados");
  await phone.close();

  // Desktop: a lista é a Table, e o SyncBadge aparece na linha.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const puts = watchPuts(page);
  const user = await signUp("Ana do roteiro");
  const other = await signUp("Bia do roteiro");

  step(3, "Entrar pelo /login com um usuário novo");
  await signIn(page, user);
  ok(`sessão ativa (${user.email}), de volta em ${route}`);
  await page.getByRole("heading", { name: "Nenhum cliente ainda" }).waitFor();
  ok("lista vazia: EmptyState");
  // O reload offline do passo 3 vem do service worker (spike 4): ele precisa estar ativo antes.
  await page.evaluate(() => navigator.serviceWorker.ready);
  ok("service worker ativo");

  step(4, "Offline: criar dois clients por /clients/edit e um imóvel do segundo por /properties/edit");
  await context.setOffline(true);
  const alfa = await create(page, "Imobiliária Alfa");
  const beta = await create(page, "Imobiliária Beta");
  for (const name of ["Imobiliária Alfa", "Imobiliária Beta"]) {
    await rowOf(page, name).getByText("Salvo no aparelho").waitFor();
  }
  ok("criados: as linhas aparecem na hora, com o SyncBadge \"Salvo no aparelho\"");
  const casa = await createProperty(page, "Imobiliária Beta", "Rua do Roteiro");
  ok("imóvel criado com a Imobiliária Beta, ainda pendente, com \"Salvo no aparelho\" em /properties");
  await until(async () => (await outboxCount(page, user)) === 3, "três transações na outbox");
  const keys = await outboxKeys(page, user);
  assert.equal(new Set(keys).size, 3);
  ok(`3 transações pendentes, chaves ${keys.join(", ")}`);
  assert.equal((await serverClient(user, alfa)).status, 404, "o client não pode estar no servidor ainda");
  assert.equal((await serverProperty(user, casa)).status, 404, "o imóvel não pode estar no servidor ainda");
  ok("o servidor ainda não conhece os clients nem o imóvel");

  step(5, "Modo avião: recarregar");
  await page.reload();
  await rowOf(page, "Imobiliária Beta").getByText("Salvo no aparelho").waitFor();
  await until(async () => (await outboxCount(page, user)) === 3, "outbox restaurada");
  assert.deepEqual(await outboxKeys(page, user), keys);
  ok("os registros e as 3 transações continuam, com as mesmas chaves; a sessão expirou");

  step(6, "Voltar a rede: a fila espera o login; SessionExpired; entrar envia");
  const before = puts.length;
  await context.setOffline(false);
  await page.waitForURL(/\/login\?next=%2Fclients$/);
  await wait(3000);
  assert.equal(puts.length, before, "sem token, a fila não pode sair");
  ok("com rede e sem token: o shell manda para o /login e nenhum PUT sai");
  const notice = await signIn(page, user, { expired: true });
  assert.match(notice ?? "", /enviar as 3 alterações salvas neste aparelho/);
  ok(`/login mostrou: "${notice}"`);
  await until(async () => (await outboxCount(page, user)) === 0, "outbox vazia", 90_000);
  const sent = puts.slice(before).filter((put) => put.status === 201);
  assert.deepEqual(
    sent.map((put) => put.key),
    keys,
    "cada transação sai uma vez com sucesso, na ordem, com a sua chave",
  );
  assert.deepEqual(sent.map((put) => put.id), [alfa, beta, casa]);
  assert.deepEqual(sent.map((put) => put.entity), ["clients", "clients", "properties"]);
  assert.ok(
    puts.slice(before).every((put) => put.entity === "clients" || put.at > sent[1].at),
    "o imóvel não sai antes do cliente",
  );
  for (const put of sent) {
    assert.match(put.auth ?? "", /^Bearer .+/);
    assert.equal(put.ifMatch, undefined, "criação sem If-Match");
  }
  ok(`2 PUT de clients e depois 1 PUT de properties, com Authorization e Idempotency-Key, sem If-Match (${sent.map((p) => p.status).join(", ")})`);
  for (const name of ["Imobiliária Alfa", "Imobiliária Beta"]) {
    await until(async () => (await rowOf(page, name).getByText("Salvo no aparelho").count()) === 0, `badge de ${name} some`);
  }
  ok("sincronizado: o SyncBadge some das linhas (silêncio no caminho feliz)");
  for (const [id, name] of [[alfa, "Imobiliária Alfa"], [beta, "Imobiliária Beta"]]) {
    const saved = await serverClient(user, id);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.name, name);
  }
  const property = await serverProperty(user, casa);
  assert.equal(property.status, 200);
  assert.equal(property.body.clientId, beta);
  assert.equal(property.body.zipCode, "40010000");
  assert.equal(property.body.state, "BA");
  const client = await serverClient(user, beta);
  assert.ok(client.body.createdAt <= property.body.createdAt, "o cliente chega antes do imóvel");
  ok("getClient e getProperty confirmam os três no SQL Server, o imóvel da Beta depois dela (CEP sem hífen, UF BA)");

  step(7, "Editar um client sincronizado: If-Match com a version do servidor");
  const created = await serverClient(user, alfa);
  await rowOf(page, "Imobiliária Alfa").getByRole("link").click();
  await page.getByRole("heading", { level: 1, name: "Imobiliária Alfa" }).waitFor();
  await page.getByRole("banner").getByText("Sincronizado").first().waitFor();
  await page.getByLabel("Telefone").fill("(71) 3333-0000");
  const fromEdit = puts.length;
  await page.getByRole("button", { name: "Salvar" }).click();
  await settled(page, user, puts, fromEdit, 200, "edição aceita");
  const [edit] = puts.slice(fromEdit);
  assert.equal(edit.ifMatch, `"${created.body.version}"`);
  const edited = await serverClient(user, alfa);
  assert.equal(edited.body.phone, "(71) 3333-0000");
  assert.notEqual(edited.body.version, created.body.version);
  ok(`PUT com If-Match ${edit.ifMatch} → 200, version ${edited.body.version}`);

  step(8, "Derrubar a resposta depois de o servidor processar: o reenvio recebe a gravada, sem subir a versão");
  /** Derruba a 1ª resposta de PUT da `entity` depois de o servidor processar; devolve o ETag que se perdeu. */
  const dropFirstPut = async (entity) => {
    const lost = {};
    await context.route(`**/api/v1/${entity}/*`, async (r) => {
      if (r.request().method() !== "PUT" || lost.status) return r.fallback();
      const answer = await r.fetch();
      lost.status = answer.status();
      lost.etag = answer.headers()["etag"];
      console.log(`   · servidor respondeu ${lost.status} (ETag ${lost.etag}); a resposta não chega à página`);
      return r.abort("connectionreset");
    });
    return lost;
  };
  const lostCreate = await dropFirstPut("clients");
  const fromDrop = puts.length;
  const gama = await create(page, "Gama Imóveis");
  await settled(page, user, puts, fromDrop, 201, "reenvio confirmado");
  await context.unroute("**/api/v1/clients/*");
  const attempts = puts.slice(fromDrop);
  assert.ok(attempts.length >= 2, `esperava reenvio, houve ${attempts.length} envio(s)`);
  assert.equal(new Set(attempts.map((put) => put.key)).size, 1, "a mesma chave em todo envio");
  assert.equal(new Set(attempts.map((put) => put.body)).size, 1, "o mesmo corpo em todo envio");
  ok(`${attempts.length} envios com a mesma chave ${attempts[0].key} e o mesmo corpo`);
  const after = await serverClient(user, gama);
  assert.equal(after.body.name, "Gama Imóveis");
  assert.equal(attempts.at(-1).etag, lostCreate.etag, "o reenvio recebe a resposta gravada");
  assert.equal(after.body.version, versionOf(lostCreate.etag), "a versão não sobe no reenvio");
  ok(`um client só no servidor (id ${gama}); o reenvio recebeu o 201 gravado, e a version ficou em ${after.body.version}`);

  // A mesma coisa numa edição: o reenvio leva um If-Match que já venceu (o servidor aplicou o 1º), e mesmo assim
  // recebe o 200 gravado, não 412: a idempotência responde antes da checagem de versão.
  await goTo(page, "Imóveis");
  const casaAddress = "Rua do Roteiro, 10";
  const beforeEdit = await serverProperty(user, casa);
  const lostEdit = await dropFirstPut("properties");
  const fromEditDrop = puts.length;
  await editNotes(page, casaAddress, "Chave na portaria");
  await settled(page, user, puts, fromEditDrop, 200, "reenvio da edição confirmado");
  await context.unroute("**/api/v1/properties/*");
  const editAttempts = puts.slice(fromEditDrop);
  assert.ok(editAttempts.length >= 2, `esperava reenvio, houve ${editAttempts.length} envio(s)`);
  assert.equal(new Set(editAttempts.map((put) => put.key)).size, 1);
  assert.ok(editAttempts.every((put) => put.ifMatch === `"${beforeEdit.body.version}"`), "o mesmo If-Match em todo envio");
  assert.ok(editAttempts.every((put) => put.status !== 412), "o reenvio não pode virar conflito");
  assert.equal(editAttempts.at(-1).etag, lostEdit.etag);
  const afterEdit = await serverProperty(user, casa);
  assert.equal(afterEdit.body.notes, "Chave na portaria");
  assert.equal(afterEdit.body.version, versionOf(lostEdit.etag), "a versão sobe uma vez só");
  ok(`edição: ${editAttempts.length} envios com If-Match ${editAttempts[0].ifMatch}; o reenvio recebeu o 200 gravado, version ${afterEdit.body.version}`);

  step(9, "Duas edições seguidas do mesmo imóvel: saem em ordem, a 2ª com a version da 1ª no If-Match");
  await context.setOffline(true);
  await editNotes(page, casaAddress, "Nota A");
  await editNotes(page, casaAddress, "Nota B");
  await until(async () => (await outboxCount(page, user)) === 2, "duas edições na outbox");
  const chainKeys = await outboxKeys(page, user);
  const fromChain = puts.length;
  await context.setOffline(false);
  await until(async () => (await outboxCount(page, user)) === 0, "as duas edições saem", 90_000);
  const chain = chainKeys.map((key) => puts.slice(fromChain).find((put) => put.key === key && put.status === 200));
  assert.ok(chain.every(Boolean), "cada edição aceita com 200");
  assert.ok(chain[0].at < chain[1].at, "a 1ª sai antes da 2ª");
  assert.equal(chain[0].ifMatch, `"${afterEdit.body.version}"`);
  assert.equal(chain[1].ifMatch, chain[0].etag, "a 2ª leva a version que a 1ª devolveu");
  const chained = await serverProperty(user, casa);
  assert.equal(chained.body.notes, "Nota B");
  assert.equal(chained.body.version, versionOf(chain[1].etag));
  ok(`If-Match ${chain[0].ifMatch} → 200 ${chain[0].etag}; If-Match ${chain[1].ifMatch} → 200 ${chain[1].etag}; servidor com "Nota B"`);

  step(10, "412 version-conflict: outro aparelho mudou o client; marca o conflito e não entra em laço");
  await goTo(page, "Clientes");
  const known = await serverClient(user, alfa);
  const elsewhere = await callApi(`/api/v1/clients/${alfa}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${user.token}`,
      "if-match": `"${known.body.version}"`,
      "idempotency-key": uuidv7(),
    },
    body: JSON.stringify({ name: "Imobiliária Alfa", document: null, email: "outro@aparelho.com", phone: null }),
  });
  assert.equal(elsewhere.status, 200, `o PUT do outro aparelho respondeu ${elsewhere.status}`);
  ok(`outro aparelho gravou a version ${elsewhere.body.version}; este ainda tem a ${known.body.version}`);
  await rowOf(page, "Imobiliária Alfa").getByRole("link").click();
  await page.getByRole("heading", { level: 1, name: "Imobiliária Alfa" }).waitFor();
  await page.getByLabel("Telefone").fill("(71) 4444-0000");
  const fromConflict = puts.length;
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  await settled(page, user, puts, fromConflict, 412, "o 412 tira a transação da fila");
  await wait(5000);
  const conflictPuts = puts.slice(fromConflict);
  assert.equal(conflictPuts.length, 1, "version-conflict não pode ser reenviado");
  assert.equal(conflictPuts[0].ifMatch, `"${known.body.version}"`);
  await rowOf(page, "Imobiliária Alfa").getByText("Conflito").waitFor();
  const kept = await serverClient(user, alfa);
  assert.equal(kept.body.version, elsewhere.body.version);
  assert.equal(kept.body.email, "outro@aparelho.com");
  assert.notEqual(kept.body.phone, "(71) 4444-0000", "a edição em conflito não chega ao servidor");
  ok("PUT com If-Match antigo → 412; 1 envio em 5 s, a outbox vazia e a linha com \"Conflito\"; o servidor fica com a do outro aparelho");

  step(11, "409 idempotency-in-progress: a nova tentativa espera o Retry-After, com a mesma chave");
  let inProgress = 0;
  await context.route("**/api/v1/clients/*", (r) => {
    if (r.request().method() !== "PUT" || inProgress++ > 0) return r.fallback();
    return r.fulfill({
      status: 409,
      contentType: "application/problem+json",
      headers: { "retry-after": "2" },
      body: problem("idempotency-in-progress", 409, "Em processamento"),
    });
  });
  const fromInProgress = puts.length;
  await create(page, "Épsilon Imóveis");
  await settled(page, user, puts, fromInProgress, 201, "aceito depois do Retry-After");
  await context.unroute("**/api/v1/clients/*");
  const waited = puts.slice(fromInProgress);
  assert.equal(waited.length, 2);
  assert.equal(waited[0].status, 409);
  assert.equal(waited[0].key, waited[1].key);
  const gap = waited[1].at - waited[0].at;
  assert.ok(gap >= 2000, `a nova tentativa saiu ${gap} ms depois, antes do Retry-After de 2 s`);
  ok(`409 com Retry-After: 2 → nova tentativa ${gap} ms depois, com a mesma chave → 201`);

  step(12, "Grupos de falha: retry tenta de novo; validation volta ao formulário, no campo");
  let internal = 0;
  await context.route("**/api/v1/clients/*", (r) => {
    if (r.request().method() !== "PUT" || internal++ > 0) return r.fallback();
    return r.fulfill({ status: 500, contentType: "application/problem+json", body: problem("internal", 500, "Erro") });
  });
  const fromInternal = puts.length;
  await create(page, "Delta Imóveis");
  await settled(page, user, puts, fromInternal, 201, "retry depois do 500");
  await context.unroute("**/api/v1/clients/*");
  const retried = puts.slice(fromInternal);
  assert.equal(retried.length, 2);
  assert.equal(retried[0].key, retried[1].key);
  ok(`500 internal → nova tentativa ${retried[1].at - retried[0].at} ms depois, com a mesma chave`);

  const refused = "Nome recusado pelo roteiro.";
  await context.route("**/api/v1/clients/*", (r) =>
    r.request().method() === "PUT"
      ? r.fulfill({
          status: 400,
          contentType: "application/problem+json",
          body: problem("validation", 400, "Inválido", { errors: { name: [refused] } }),
        })
      : r.fallback(),
  );
  const fromValidation = puts.length;
  await create(page, "Nome recusado");
  await settled(page, user, puts, fromValidation, 400, "transação recusada sai da fila");
  await wait(5000);
  await context.unroute("**/api/v1/clients/*");
  assert.equal(puts.length - fromValidation, 1, "validation não pode ser reenviado");
  await rowOf(page, "Nome recusado").getByText("Correção necessária").waitFor();
  ok("400 validation → 1 envio em 5 s; a linha fica, com \"Correção necessária\"");
  await rowOf(page, "Nome recusado").getByRole("link").click();
  await page.getByText(refused).waitFor();
  assert.equal(await page.getByLabel("Nome").getAttribute("aria-invalid"), "true");
  ok(`o formulário reabre com "${refused}" no campo Nome`);
  await page.getByRole("link", { name: "Voltar" }).click();
  await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();

  step(13, "Outro usuário entra: a fila do anterior não sai com a conta dele");
  // Com a página controlada pelo service worker, o modo avião do Playwright não barra o fetch que passa por ele;
  // a pendência nasce offline com a sessão expirada (recarregou), e a fila espera pelo token.
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  const fromPending = puts.length;
  const pending = await create(page, "Pendência da Ana");
  await until(async () => (await outboxCount(page, user)) === 1, "uma pendência da Ana");
  await context.setOffline(false);
  await page.waitForURL(/\/login\?next=%2Fclients$/);
  await wait(2000);
  assert.equal(puts.length, fromPending, "sem token, a pendência não sai");
  ok("sessão expirada: a pendência fica na fila");
  const fromOther = puts.length;
  await signIn(page, other, { expired: true });
  await page.getByRole("heading", { name: "Nenhum cliente ainda" }).waitFor();
  await until(async () => (await outboxCount(page, other)) === 0, "a outbox da Bia, vazia");
  await wait(5000);
  assert.equal(puts.length - fromOther, 0, "nenhum PUT da fila da Ana com a sessão da Bia");
  assert.equal((await serverClient(user, pending)).status, 404);
  ok("a Bia vê o banco dela, vazio; em 5 s nenhum PUT, e o servidor não recebeu a pendência");
  await page.reload();
  await signIn(page, user, { expired: true });
  await until(async () => (await outboxCount(page, user)) === 0, "a fila da Ana sai", 90_000);
  assert.equal((await serverClient(user, pending)).body.name, "Pendência da Ana");
  assert.equal((await serverClient(other, pending)).status, 404, "a pendência é da Ana, não da Bia");
  ok("a Ana entra de novo e a pendência dela chega ao servidor, na conta dela");

  console.log("\nRoteiro concluído.");
} finally {
  await browser.close();
  server.close();
}
