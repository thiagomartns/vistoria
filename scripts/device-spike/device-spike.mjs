// `pnpm spike:device`
// Roteiro da entrega do M4 (#135), com o resto do spike 4: o aparelho novo baixa tudo, duas abas renovam a sessão sem
// deslogar e a pendência do aparelho sobrevive ao pull (ADR 0041). O volume é do spike 2 (#134); a convergência pelo
// pull de dois aparelhos é o passo 5 do `spike:conflict`.
// Exige `pnpm db:up`, `pnpm dev:api` (http://localhost:8080) e `pnpm --filter web build`.
// O celular (A) cria os dados pela tela. O desktop (B) é o aparelho novo: entra num contexto limpo, com o service worker
// ligado, e depois abre em modo avião. Duas abas de B, com o access token vencido, pedem dados juntas. O token vencido é
// o que o roteiro estraga: a API o recusa com o mesmo 401 `unauthorized` de um token expirado, que só vence em 15 min e
// pelo relógio da própria API. As duas pedem dados pelo gatilho do intervalo do pull, chamado pelo roteiro.
// Com SCREENS=1, tira os prints em `.screens/aparelho/`, para `pnpm screens --files .screens/aparelho`. Aceita
// PULL_CHAOS=1, como os outros roteiros.

import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  base,
  checked,
  create,
  createInspection,
  createProperty,
  currentRoomIs,
  deleteOnServer,
  goTo,
  inspectionRow,
  inspectionSettled,
  launch,
  linkOf,
  mark,
  ok,
  openRoom,
  outboxCount,
  printTrace,
  pullNow,
  root,
  serve,
  serverInspection,
  settled,
  shooter,
  signIn,
  signUp,
  step,
  until,
  wait,
  watchPuts,
} from "../outbox-spike/lib.mjs";

const shoot = shooter(process.env.SCREENS ? resolve(process.env.INIT_CWD ?? root, ".screens/aparelho") : null);

const GET_BY_ID = /^\/api\/v1\/(clients|properties|inspections)\/[^/]+$/;

/** A condição de um item no servidor. */
const conditionOf = (inspection, room, item) =>
  inspection.rooms.find((r) => r.name === room).items.find((i) => i.name === item).condition;

/** O link da vistoria `id` na lista (a Table no desktop, a ListRow no celular): o endereço se repete entre vistorias. */
const inspectionLink = (page, id) => page.locator(`a[href$="id=${id}"]`).locator("visible=true").first();

/**
 * Guarda os handlers do intervalo de 60 s (o do pull, `PULL_INTERVAL_MS`, e o da janela offline, que só lê o relógio):
 * `tick(page)` chama os dois, como se o minuto tivesse passado. Compõe com o `PULL_CHAOS`, que troca o intervalo depois.
 */
async function captureTicks(context) {
  await context.addInitScript(() => {
    const ticks = new Map();
    const setInterval = window.setInterval;
    const clearInterval = window.clearInterval;
    window.setInterval = (handler, ms, ...args) => {
      const id = setInterval(handler, ms, ...args);
      if (ms === 60_000) ticks.set(id, handler);
      return id;
    };
    window.clearInterval = (id) => {
      ticks.delete(id);
      return clearInterval(id);
    };
    window.__spikeTick = () => {
      for (const handler of ticks.values()) handler();
      return ticks.size;
    };
  });
}

const tick = (page) => page.evaluate(() => window.__spikeTick());

/**
 * O access token vencido: `expire()` marca os tokens que o contexto já usou, e as requisições com um deles saem com a
 * assinatura estragada. A API responde 401 `unauthorized`, como a um expirado. O token que o refresh trouxer passa.
 */
async function tokenExpiry(context) {
  const seen = new Set();
  const stale = new Set();
  const bearer = (request) => request.headers()["authorization"]?.replace(/^Bearer /, "");
  context.on("request", (request) => {
    const token = bearer(request);
    if (token) seen.add(token);
  });
  await context.route(/\/api\/v1\/(?!auth\/)/, async (route) => {
    const token = bearer(route.request());
    if (!token || !stale.has(token)) return route.fallback();
    const headers = { ...route.request().headers(), authorization: `Bearer ${token.slice(0, -6)}AAAAAA` };
    return route.fallback({ headers });
  });
  return () => {
    for (const token of seen) stale.add(token);
    return stale.size;
  };
}

/** Todo `POST /auth/refresh` do contexto, de qualquer aba: o status e se a resposta mandou cookie novo (rotação). */
function watchContextRefreshes(context) {
  const refreshes = [];
  context.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/auth/refresh")) return;
    const entry = { tab: request.frame()?.page(), status: null, rotated: null };
    refreshes.push(entry);
    request.response().then(
      async (res) => {
        entry.rotated = Boolean((await res?.allHeaders())?.["set-cookie"]);
        entry.status = res?.status() ?? "sem resposta";
      },
      () => (entry.status = "falhou"),
    );
  });
  return refreshes;
}

/** As respostas do delta (`/sync/*`) de uma aba, com o status. */
function watchSync(page) {
  const answers = [];
  page.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith("/api/v1/sync/")) answers.push({ path, status: res.status() });
  });
  return answers;
}

/** Espera os refresh a partir de `from` responderem todos, e ao menos `count`. */
const refreshesDone = (refreshes, from, count, what) =>
  until(
    () => refreshes.length - from >= count && refreshes.slice(from).every((r) => r.status !== null),
    what,
  );

/** A aba segue dentro do app, sem /login e sem "Sua sessão expirou". */
async function staysSignedIn(page, what) {
  assert.ok(!new URL(page.url()).pathname.startsWith("/login"), `${what}: não foi para o /login`);
  assert.equal(await page.getByText("Sua sessão expirou").count(), 0, `${what}: sem "Sua sessão expirou"`);
}

/** Volta da tela de campo para a lista de vistorias. */
async function backToList(page) {
  await page.getByRole("link", { name: "Voltar", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
}

/** Recarrega a aba com rede: a sessão renova pelo cookie (#132) e a lista de vistorias volta. */
async function reloadSignedIn(page, refreshes) {
  const from = refreshes.length;
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  await refreshesDone(refreshes, from, 1, "o refresh do reload");
  assert.ok(refreshes.slice(from).every((r) => r.status === 200), "o refresh do reload é aceito");
}

const server = await serve();
const browser = await launch();
try {
  const user = await signUp("Dora do aparelho novo");
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const a = await phone.newPage();
  const aPuts = watchPuts(a);
  const clientName = "Imobiliária Aparelho Novo";
  const street = "Rua do Aparelho";
  const address = `${street}, 10`;
  const option = `${address} · ${clientName}`;

  step(1, "Preparo: o celular cria cliente, imóvel e três vistorias; outro aparelho exclui a terceira");
  await signIn(a, user);
  await create(a, clientName);
  await createProperty(a, clientName, street, { pending: false });
  const first = await createInspection(a, option);
  await mark(a, "Piso", "Bom");
  await mark(a, "Paredes", "Regular");
  await openRoom(a, "Cozinha");
  await mark(a, "Teto", "Ruim");
  await inspectionSettled(a, user, "a primeira vistoria sincroniza");
  await backToList(a);
  const second = await createInspection(a, option);
  await mark(a, "Piso", "Novo");
  await inspectionSettled(a, user, "a segunda vistoria sincroniza");
  await backToList(a);
  const third = await createInspection(a, option);
  await inspectionSettled(a, user, "a terceira vistoria sincroniza");
  await backToList(a);
  await deleteOnServer(user, third);
  assert.equal((await serverInspection(user, third)).status, 404);
  ok("no servidor: um cliente, um imóvel, duas vistorias vivas com itens marcados e uma excluída");

  step(2, "Aparelho novo: entra num contexto limpo, baixa tudo pelo delta e depois abre em modo avião");
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await captureTicks(desk);
  const expire = await tokenExpiry(desk);
  const refreshes = watchContextRefreshes(desk);
  const b = await desk.newPage();
  const bPuts = watchPuts(b);
  const bSync = watchSync(b);
  const byId = [];
  desk.on("response", (res) => {
    if (res.request().method() === "GET" && GET_BY_ID.test(new URL(res.url()).pathname)) byId.push(res.url());
  });
  await signIn(b, user, { next: "/inspections" });
  await b.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  await inspectionRow(b, first).waitFor({ timeout: 30_000 });
  await inspectionRow(b, second).waitFor();
  await until(
    () => ["clients", "properties", "inspections"].every((e) => bSync.some((s) => s.path.endsWith(e) && s.status === 200)),
    "o primeiro pull das três entidades",
  );
  assert.equal(await inspectionRow(b, third).count(), 0, "a excluída não chega");
  await shoot(b, "aparelho-1-lista");
  await goTo(b, "Clientes");
  await linkOf(b, clientName).waitFor();
  await goTo(b, "Imóveis");
  await linkOf(b, address).waitFor();
  await goTo(b, "Vistorias");
  await inspectionLink(b, first).click();
  await b.getByRole("heading", { level: 1, name: address }).waitFor();
  await currentRoomIs(b, "Sala");
  assert.ok(await checked(b, "Piso", "Bom"));
  assert.ok(await checked(b, "Paredes", "Regular"));
  await openRoom(b, "Cozinha");
  assert.ok(await checked(b, "Teto", "Ruim"));
  assert.deepEqual(byId, [], "tudo veio pelo delta, sem GET por id");
  assert.equal(await outboxCount(b, user), 0);
  ok("clientes, imóveis e as duas vistorias com os itens do celular, só pelo delta (nenhum GET por id); a excluída não aparece");

  const sw = await b.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
  assert.equal(sw, "activated", "o service worker precisa estar ativo");
  await backToList(b);
  await b.waitForLoadState("networkidle");
  await desk.setOffline(true);
  const offlineReload = await b.reload();
  assert.ok(offlineReload?.fromServiceWorker(), "/inspections veio do service worker");
  await b.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  await b.getByText("Você está offline").first().waitFor();
  await inspectionRow(b, first).waitFor();
  await inspectionRow(b, second).waitFor();
  assert.equal(await inspectionRow(b, third).count(), 0);
  await staysSignedIn(b, "recarregado offline");
  await shoot(b, "aparelho-2-offline");
  await inspectionLink(b, second).click();
  await b.getByRole("heading", { level: 1, name: address }).waitFor();
  await currentRoomIs(b, "Sala");
  assert.ok(await checked(b, "Piso", "Novo"));
  assert.deepEqual(byId, [], "nada pedido por id offline");
  ok("em modo avião, recarregado: o shell vem do service worker, a lista e a tela de campo vêm do banco local, sem /login");

  step(3, "Duas abas, com o access token vencido, pedem dados juntas: sai um refresh só, e ninguém é deslogado");
  let from = refreshes.length;
  await desk.setOffline(false);
  await refreshesDone(refreshes, from, 1, "a volta da rede renova");
  await backToList(b);
  const b2 = await desk.newPage();
  const b2Sync = watchSync(b2);
  from = refreshes.length;
  await b2.goto(`${base}/inspections`);
  await b2.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  await refreshesDone(refreshes, from, 1, "a segunda aba renova ao abrir");
  await inspectionRow(b2, first).waitFor();
  await b.waitForLoadState("networkidle");
  await b2.waitForLoadState("networkidle");
  ok("a segunda aba abre ativa, com a primeira aberta");

  assert.ok((await expire()) >= 1, "há token a vencer");
  from = refreshes.length;
  const syncFrom = [bSync.length, b2Sync.length];
  const ticked = await Promise.all([tick(b), tick(b2)]);
  assert.ok(ticked.every((n) => n >= 1), "os dois intervalos do pull existem");
  const pulledAgain = (answers, start) => {
    const after = answers.slice(start);
    const refused = after.findIndex((s) => s.status === 401);
    return refused >= 0 && after.slice(refused + 1).some((s) => s.status === 200);
  };
  await until(
    () => pulledAgain(bSync, syncFrom[0]) && pulledAgain(b2Sync, syncFrom[1]),
    "as duas abas levam 401 e puxam de novo com o token novo",
  );
  await wait(2000);
  const locked = refreshes.slice(from);
  assert.deepEqual(locked.map((r) => r.status), [200], "um refresh só, das duas abas");
  for (const [tab, name] of [[b, "primeira aba"], [b2, "segunda aba"]]) await staysSignedIn(tab, name);
  ok("com o lock: as duas levam 401 no delta, sai um refresh (200) numa aba só, as duas puxam de novo com o token novo");
  await shoot(b2, "aparelho-3-duas-abas");

  step("3b", "Sem o lock (sem Web Locks), as duas renovam juntas com o mesmo cookie, e a tolerância da API segura");
  await desk.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "locks", { configurable: true, get: () => undefined }),
  );
  await reloadSignedIn(b, refreshes);
  await reloadSignedIn(b2, refreshes);
  assert.equal(await b.evaluate(() => navigator.locks), undefined, "as abas estão sem Web Locks");
  await b.waitForLoadState("networkidle");
  await b2.waitForLoadState("networkidle");
  expire();
  from = refreshes.length;
  // Segura o primeiro refresh até o segundo sair: os dois chegam à API com o mesmo cookie.
  let arrived = 0;
  let bothArrived;
  const together = new Promise((done) => (bothArrived = done));
  const hold = async (route) => {
    if (++arrived >= 2) bothArrived();
    await Promise.race([together, wait(10_000)]);
    return route.fallback();
  };
  await desk.route("**/api/v1/auth/refresh", hold);
  const raceFrom = [bSync.length, b2Sync.length];
  await Promise.all([tick(b), tick(b2)]);
  await refreshesDone(refreshes, from, 2, "os dois refresh");
  await until(
    () => pulledAgain(bSync, raceFrom[0]) && pulledAgain(b2Sync, raceFrom[1]),
    "as duas abas puxam de novo",
  );
  await desk.unroute("**/api/v1/auth/refresh", hold);
  const raced = refreshes.slice(from);
  assert.equal(arrived, 2, "os dois refresh saíram juntos");
  assert.deepEqual(raced.map((r) => r.status), [200, 200], "os dois são aceitos");
  assert.deepEqual(raced.map((r) => r.rotated).toSorted(), [false, true], "um rotaciona o cookie; o outro cai na tolerância");
  for (const [tab, name] of [[b, "primeira aba"], [b2, "segunda aba"]]) await staysSignedIn(tab, name);
  await reloadSignedIn(b, refreshes);
  ok("sem o lock: dois refresh com o mesmo cookie, os dois 200 (um com o cookie novo, o outro na tolerância), ninguém deslogado, e o cookie que ficou renova o reload");

  step(4, "Pendência protegida: o celular, com item na fila, puxa ao voltar a rede sem perder nada, e envia");
  // A tela volta no ambiente do rascunho (ADR 0036), a Cozinha.
  await inspectionLink(a, first).click();
  await a.getByRole("heading", { level: 1, name: address }).waitFor();
  await openRoom(a, "Sala");
  await a.waitForLoadState("networkidle");
  await phone.setOffline(true);
  await a.getByText("Você está offline").first().waitFor();
  await mark(a, "Teto", "Regular");
  await wait(1800);
  assert.ok((await outboxCount(a, user)) >= 1, "a edição do celular fica na fila");
  await inspectionLink(b, first).click();
  await b.getByRole("heading", { level: 1, name: address }).waitFor();
  await openRoom(b, "Sala");
  await mark(b, "Janelas", "Bom");
  await inspectionSettled(b, user, "a edição do desktop sincroniza");
  const atDesk = (await serverInspection(user, first)).body;
  assert.equal(conditionOf(atDesk, "Sala", "Janelas"), "good");
  ok("celular offline marca Sala/Teto (na fila); desktop marca Sala/Janelas → 200");
  // Os PUTs do celular esperam o pull: o delta chega com o registro em pendência e tem de pulá-lo.
  let releasePuts;
  const putsReleased = new Promise((done) => (releasePuts = done));
  const holdPuts = async (route) => {
    if (route.request().method() === "PUT") await putsReleased;
    return route.fallback();
  };
  await phone.route(/\/api\/v1\/inspections\//, holdPuts);
  const pulled = a.waitForResponse((res) => new URL(res.url()).pathname === "/api/v1/sync/inspections", {
    timeout: 30_000,
  });
  const fromPhone = aPuts.length;
  await phone.setOffline(false);
  assert.equal((await pulled).status(), 200);
  await wait(1500);
  assert.ok(await checked(a, "Teto", "Regular"), "o pull não desfaz o Teto da fila");
  assert.ok(!(await checked(a, "Janelas", "Bom")), "nem grava o registro com pendência");
  assert.ok((await outboxCount(a, user)) >= 1, "a fila continua com a edição");
  ok("a rede volta: o delta responde 200 com a edição na fila, e o celular segue com o Teto, sem as Janelas");
  releasePuts();
  await settled(a, user, aPuts, fromPhone, 200, "a edição do celular sai");
  await phone.unroute(/\/api\/v1\/inspections\//, holdPuts);
  const phoneStatuses = aPuts.slice(fromPhone).map((put) => put.status);
  assert.deepEqual(phoneStatuses, [412, 200], "um 412 e o reenvio do merge");
  assert.equal(await a.getByText("Esta vistoria foi alterada em outro aparelho").count(), 0, "sem colisão, sem aviso");
  const both = (await serverInspection(user, first)).body;
  assert.equal(conditionOf(both, "Sala", "Teto"), "fair", "o Teto do celular");
  assert.equal(conditionOf(both, "Sala", "Janelas"), "good", "as Janelas do desktop");
  await until(async () => checked(a, "Janelas", "Bom"), "as Janelas do desktop no celular", 10_000);
  assert.ok(await checked(a, "Teto", "Regular"));
  ok("o PUT → 412 → merge sem colisão → 200: o servidor e o celular ficam com o Teto e as Janelas");
  await shoot(a, "aparelho-4-pendencia");
  const deskPuts = bPuts.length;
  await pullNow(desk, b);
  await until(async () => checked(b, "Teto", "Regular"), "o Teto do celular no desktop", 10_000);
  assert.ok(await checked(b, "Janelas", "Bom"));
  assert.equal(bPuts.length, deskPuts, "o desktop recebe pelo pull, sem enviar");
  assert.equal(await outboxCount(a, user), 0);
  assert.equal(await outboxCount(b, user), 0);
  ok("o desktop recebe o Teto do celular pelo pull; filas vazias");

  console.log("\nRoteiro concluído.");
} catch (error) {
  printTrace();
  throw error;
} finally {
  await browser.close();
  server.close();
}
