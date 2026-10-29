// Helpers dos roteiros contra a API real: `pnpm spike:outbox` (spikes 1a e 1b, entregas do M2) e `pnpm spike:conflict`
// (spike 3). Servem `apps/web/out` com `/api/*` repassado para a API, na mesma origem, como o Caddy em produção.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { extname, join, resolve } from "node:path";

import { chromium } from "playwright-core";

import { VIEWPORTS, candidateFiles } from "../screens/lib.mjs";

export const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "apps/web/out");
const api = new URL(process.env.API_URL ?? "http://localhost:8080");
export const route = "/clients";

/** A origem do app servido, depois do `serve()`. */
export let base;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Confere o build e a API, e serve o static export numa porta livre (`base`). */
export async function serve() {
  if (!existsSync(join(outDir, "index.html"))) {
    throw new Error("apps/web/out não existe: rode `pnpm --filter web build` antes.");
  }
  const health = await callApi("/api/v1/health").catch(() => ({ status: 0 }));
  assert.equal(health.status, 200, `API fora do ar em ${api}: rode \`pnpm dev:api\`.`);
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
  return server;
}

export const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return chromium.launch();
  }
}

export async function callApi(path, init = {}) {
  const response = await fetch(new URL(path, api), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Uma Idempotency-Key UUID v7, a única que a API aceita (o resto é 428). */
export function uuidv7() {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Senha gerada na hora e nunca impressa (ADR 0025).
export async function signUp(name) {
  const user = {
    name,
    email: `spike-${Date.now()}-${randomBytes(3).toString("hex")}@exemplo.com`,
    password: randomBytes(18).toString("base64url"),
  };
  const { status, body } = await callApi("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(user) });
  assert.equal(status, 201, `signup respondeu ${status}`);
  return { ...user, id: body.user.id, token: body.accessToken };
}

export async function serverClient(user, id) {
  return callApi(`/api/v1/clients/${id}`, { headers: { authorization: `Bearer ${user.token}` } });
}

export async function serverProperty(user, id) {
  return callApi(`/api/v1/properties/${id}`, { headers: { authorization: `Bearer ${user.token}` } });
}

export async function serverInspection(user, id) {
  return callApi(`/api/v1/inspections/${id}`, { headers: { authorization: `Bearer ${user.token}` } });
}

/** Outro aparelho exclui a vistoria (`DELETE` direto na API, com a versão que o servidor tem). */
export async function deleteOnServer(user, id) {
  const { version } = (await serverInspection(user, id)).body;
  const { status } = await callApi(`/api/v1/inspections/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${user.token}`, "if-match": `"${version}"`, "idempotency-key": uuidv7() },
  });
  assert.equal(status, 204, `o DELETE do outro aparelho respondeu ${status}`);
}

/** Outro aparelho muda a vistoria (`PUT` direto na API): `change` recebe cada item com o nome do ambiente. */
export async function changeOnServer(user, id, change) {
  const seen = (await serverInspection(user, id)).body;
  const { status, body } = await callApi(`/api/v1/inspections/${id}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${user.token}`, "if-match": `"${seen.version}"`, "idempotency-key": uuidv7() },
    body: JSON.stringify({
      propertyId: seen.propertyId,
      kind: seen.kind,
      status: seen.status,
      startedAt: seen.startedAt,
      generalNotes: seen.generalNotes,
      rooms: seen.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        position: room.position,
        notes: room.notes,
        items: room.items.map(({ id: itemId, name, position, condition, notes }) =>
          change(room.name, { id: itemId, name, position, condition, notes }),
        ),
      })),
    }),
  });
  assert.equal(status, 200, `o PUT do outro aparelho respondeu ${status}`);
  return body.version;
}

/** Todo PUT de client, imóvel e vistoria que a página dispara, com o que interessa ao roteiro. */
export function watchPuts(page) {
  const puts = [];
  page.on("request", (req) => {
    const entity = req.url().match(/\/api\/v1\/(clients|properties|inspections)\//)?.[1];
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

/** Todo DELETE de vistoria que a página dispara, com a chave, o If-Match e o status. */
export function watchDeletes(page) {
  const deletes = [];
  page.on("request", (req) => {
    if (req.method() !== "DELETE" || !/\/api\/v1\/inspections\//.test(req.url())) return;
    const entry = {
      at: Date.now(),
      id: req.url().split("/").pop(),
      key: req.headers()["idempotency-key"],
      ifMatch: req.headers()["if-match"],
      status: null,
    };
    deletes.push(entry);
    req.response().then(
      (res) => (entry.status = res?.status() ?? "sem resposta"),
      () => (entry.status = "falhou"),
    );
  });
  return deletes;
}

/** Abre o "···" (Mais ações) de `scope` e escolhe "Excluir vistoria": o Dialog de confirmação abre. */
export async function askToDelete(page, scope) {
  await scope.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: "Excluir vistoria" }).click();
  return page.getByRole("dialog", { name: "Excluir esta vistoria?" });
}

/** A linha da Table (desktop) da vistoria `id`: o endereço se repete entre vistorias do mesmo imóvel. */
export const inspectionRow = (page, id) => page.getByRole("row").filter({ has: page.locator(`a[href$="id=${id}"]`) });

/** Entra pelo /login e volta para `next` (a lista de clientes, onde espera o título, ou outra tela, que o chamador espera). */
export async function signIn(page, user, { expired, next = route } = {}) {
  await page.goto(`${base}/login?next=${encodeURIComponent(next)}`);
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
  if (next === route) await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  return notice;
}

/** Abaixo de `md` a Table vira lista de ListRow. */
export const isMobile = (page) => page.viewportSize().width < 768;

/** A linha da lista com o título: a da Table no desktop, a ListRow (um link só) no celular. */
export const rowOf = (page, name) =>
  isMobile(page)
    ? page.getByRole("list").getByRole("link").filter({ has: page.getByText(name, { exact: true }) })
    : page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

/** O link que abre o registro com o título, na lista. */
export const linkOf = (page, name) =>
  isMobile(page) ? rowOf(page, name) : page.getByRole("table").getByRole("link", { name, exact: true });

export const idOf = async (link) => new URL(await link.getAttribute("href"), base).searchParams.get("id");

/** Cria um client por /clients/edit, de volta na lista, e devolve o id gerado no aparelho. */
export async function create(page, name) {
  await page.getByRole("link", { name: "Novo cliente" }).first().click();
  await page.getByRole("heading", { level: 1, name: "Novo cliente" }).waitFor();
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("button", { name: "Salvar" }).click();
  const link = linkOf(page, name);
  await link.waitFor({ timeout: 2000 });
  return idOf(link);
}

/** De /clients para /properties (ou o contrário) pela navegação do app. */
export async function goTo(page, title) {
  await page.getByRole("navigation").getByRole("link", { name: title }).click();
  await page.getByRole("heading", { level: 1, name: title }).waitFor();
}

/**
 * Vai de /clients a /properties e cria um imóvel do cliente `clientName` por /properties/edit; volta para /clients.
 * Offline (`pending`, o padrão), confere o "Salvo no aparelho" da linha; online, ele some antes de dar para ver.
 */
export async function createProperty(page, clientName, street, { pending = true } = {}) {
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
  if (pending) await rowOf(page, address).getByText("Salvo no aparelho").waitFor();
  const id = await idOf(link);
  await goTo(page, "Clientes");
  return id;
}

/** Em /properties, abre o imóvel pelo endereço, troca as observações (fora do endereço) e salva; volta para a lista. */
export async function editNotes(page, address, notes) {
  await linkOf(page, address).click();
  await page.getByRole("heading", { level: 1, name: address }).waitFor();
  await page.getByLabel("Observações").fill(notes);
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.getByRole("heading", { level: 1, name: "Imóveis" }).waitFor();
}

/** De /clients (ou outra lista) a /inspections/new: escolhe o imóvel, começa a vistoria e devolve o id dela. */
export async function createInspection(page, propertyOption) {
  await goTo(page, "Vistorias");
  await page.getByRole("link", { name: "Nova vistoria" }).first().click();
  await page.getByRole("heading", { level: 1, name: "Nova vistoria" }).waitFor();
  await page.getByLabel("Imóvel").click();
  await page.getByRole("option", { name: propertyOption }).click();
  await page.getByRole("button", { name: "Começar vistoria" }).click();
  await page.waitForURL(/\/inspections\/edit\?id=/);
  await currentRoomIs(page, "Sala");
  return new URL(page.url()).searchParams.get("id");
}

/** Os chips de condição de um item do ambiente aberto. */
export const chipsOf = (page, item) => page.getByRole("radiogroup", { name: `Condição: ${item}` });

/** Marca a condição de um item do ambiente aberto. */
export const mark = (page, item, condition) => chipsOf(page, item).getByRole("radio", { name: condition }).click();

export const checked = async (page, item, condition) =>
  (await chipsOf(page, item).getByRole("radio", { name: condition }).getAttribute("aria-checked")) === "true";

/** O ambiente aberto na tela de campo é `room`. */
export const currentRoomIs = (page, room) =>
  page.getByRole("heading", { level: 2, name: room, exact: true }).waitFor();

/** Vai para outro ambiente pela etapa do StepperForm. */
export async function openRoom(page, room) {
  await page.getByRole("navigation", { name: "Ambientes" }).getByRole("button", { name: new RegExp(`^${room}`) }).click();
  await currentRoomIs(page, room);
}

/** A tela de campo manda para a fila 1,5 s depois da última mudança: espera isso e a fila esvaziar. */
export async function inspectionSettled(page, user, what) {
  await wait(1800);
  await until(async () => (await outboxCount(page, user)) === 0, what, 90_000);
}

/** Tira prints em `dir` (nada sem `dir`): o mesmo estado no celular e no desktop, trocando o viewport. */
export function shooter(dir) {
  return async function shoot(page, name) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const original = page.viewportSize();
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(() => document.fonts.ready);
      await wait(400);
      await page.screenshot({ path: join(dir, `${name}-${viewport.name}.png`) });
    }
    await page.setViewportSize(original);
    ok(`print ${name} (celular e desktop)`);
  };
}

/** As chaves das transações na outbox do usuário, da mais antiga para a mais nova, lidas do IndexedDB dela. */
export const outboxKeys = (page, user) =>
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

export const outboxCount = async (page, user) => (await outboxKeys(page, user)).length;

export async function until(check, what, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

/** Espera um envio a partir de `from` terminar com `status` e a outbox de `user` esvaziar. */
export const settled = (page, user, puts, from, status, what) =>
  until(
    async () =>
      puts.slice(from).some((put) => put.status === status) && (await outboxCount(page, user)) === 0,
    what,
    90_000,
  ).catch(async (error) => {
    const seen = puts.slice(from).map((put) => `${put.entity} ${put.status}`);
    throw new Error(`${error.message} (envios: ${seen.join(", ") || "nenhum"}; na fila: ${await outboxCount(page, user)})`);
  });

/** A `version` de um ETag forte (`"AAAAAAAAB9M="`). */
export const versionOf = (etag) => etag?.replace(/^"|"$/g, "");

export const succeeded = (put) => put.status === 200 || put.status === 201;

/** O corpo de um ProblemDetails do contrato, para os `route.fulfill`. */
export const problem = (type, status, title, extra = {}) =>
  JSON.stringify({ type: `urn:vistoria:problem:${type}`, title, status, detail: title, traceId: "roteiro", ...extra });

export const step = (n, text) => console.log(`\n${n}. ${text}`);
export const ok = (text) => console.log(`   ✓ ${text}`);
