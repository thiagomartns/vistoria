// `pnpm spike:migration [--from REF]`
// Roteiro da migração do banco local da versão anterior para a deste build (desde a #172: da 6 para a 7, com a store de
// roteiros; antes, na #154, ADR 0048: da 5 para a 6), num
// navegador de verdade e na mesma origem. É o upgrade que os aparelhos fazem de fato:
// 1. o build de `REF` (o último commit com o banco na versão anterior) entra como o usuário de dev do `pnpm seed`,
//    baixa todas as vistorias pelo delta e marca um item numa vistoria, com o envio barrado: a transação fica na outbox;
// 2. o servidor passa a servir este build, e o service worker novo assume quando o aparelho fecha e abre o app de novo;
// 3. o banco sobe para a versão deste build, cada vistoria tem o seu resumo, os roteiros chegam pelo pull, e a lista abre
//    com todas;
// 4. o envio é liberado, e a transação feita no build antigo sai, chega ao servidor e entra na vistoria e no resumo;
// 5. em modo avião, o reload abre a lista e a tela de campo com o que foi marcado.
// O build de `REF` sai de um `git worktree` e fica em `node_modules/.cache/migration-spike/REF`.
// Exige `pnpm db:up`, `pnpm dev:api`, `pnpm seed` e `pnpm --filter web build`. A senha vem de DEV_USER_PASSWORD ou do
// infra/.env, nunca impressa (ADR 0025).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  base,
  callApi,
  launch,
  mark,
  ok,
  outboxCount,
  printTrace,
  root,
  serve,
  serveDir,
  signIn,
  step,
  until,
  wait,
} from "../outbox-spike/lib.mjs";
import {
  DEV_EMAIL,
  ROW_LINK,
  TABLE_LINK,
  apiSignIn,
  devPassword,
  listedTotal,
  markListReady,
  pageValue,
  serverInspections,
  serverTemplates,
  setOffline,
} from "./lib.mjs";

/**
 * O último commit com o banco local na versão anterior à deste build (a `main` de antes da #172: a 6). Subir a versão
 * em `local-db.ts` é trocar este sha no mesmo PR, pelo último commit da versão que fica para trás; o passo 1 quebra se
 * esquecer. O sha inteiro: o checkout raso do CI só busca um commit pelo sha completo.
 */
const PREVIOUS_REF = "ca13ce000f3fcae5a0eda9b4509a67a22d1ac0cf";

/** A versão do banco local deste build, lida de `local-db.ts`. */
function currentDbVersion() {
  const source = readFileSync(join(root, "apps", "web", "src", "shared", "db", "local-db.ts"), "utf8");
  const match = source.match(/const LOCAL_DB_VERSION = (\d+);/);
  assert.ok(match, "local-db.ts sem `const LOCAL_DB_VERSION = N;`");
  return Number(match[1]);
}
/** As condições que o roteiro alterna no item marcado. */
const CONDITIONS = { good: "Bom", poor: "Ruim" };

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 0) return { from: PREVIOUS_REF };
  if (args.length === 2 && args[0] === "--from" && /^[\w./-]+$/.test(args[1])) return { from: args[1] };
  throw new Error("Uso: pnpm spike:migration [--from REF]");
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** O static export de `ref`, construído uma vez num `git worktree` e guardado no cache. */
function oldBuild(ref) {
  const sha = (() => {
    try {
      return git("rev-parse", "--verify", `${ref}^{commit}`);
    } catch {
      // O checkout do CI é raso: o commit de antes vem do origin.
      git("fetch", "--depth", "1", "origin", ref);
      return git("rev-parse", "--verify", "FETCH_HEAD^{commit}");
    }
  })();
  const out = join(root, "node_modules", ".cache", "migration-spike", sha, "out");
  if (existsSync(join(out, "index.html"))) {
    ok(`build de ${sha.slice(0, 7)} do cache`);
    return out;
  }
  const tree = mkdtempSync(join(tmpdir(), "vistoria-migration-"));
  git("worktree", "add", "--detach", tree, sha);
  try {
    const pnpm = (...args) => execFileSync("pnpm", args, { cwd: tree, stdio: "inherit" });
    pnpm("install", "--frozen-lockfile", "--prefer-offline", "--filter", "web...");
    pnpm("--filter", "web", "build");
    cpSync(join(tree, "apps", "web", "out"), out, { recursive: true });
  } finally {
    git("worktree", "remove", "--force", tree);
    rmSync(tree, { recursive: true, force: true });
  }
  ok(`build de ${sha.slice(0, 7)} feito num git worktree`);
  return out;
}

/** O banco local do usuário, lido direto do IndexedDB: a versão, as stores e quantos registros cada uma tem. */
const localDb = (page, ownerId) =>
  page.evaluate(async (name) => {
    const request = (r) =>
      new Promise((done, fail) => {
        r.onsuccess = () => done(r.result);
        r.onerror = () => fail(r.error);
      });
    const known = (await indexedDB.databases()).find((db) => db.name === name);
    if (!known) return null;
    const db = await request(indexedDB.open(name));
    try {
      const stores = [...db.objectStoreNames];
      const counts = {};
      for (const store of stores) counts[store] = await request(db.transaction(store).objectStore(store).count());
      const versions = stores.includes("_versions")
        ? (await request(db.transaction("_versions").objectStore("_versions").getAllKeys())).map((key) => key[0])
        : [];
      return { version: db.version, stores, counts, versions };
    } finally {
      db.close();
    }
  }, `vistoria-${ownerId}`);

/** Um registro de uma store do banco local, pela chave. */
const localRecord = (page, ownerId, store, key) =>
  page.evaluate(
    async ([name, storeName, id]) => {
      const request = (r) =>
        new Promise((done, fail) => {
          r.onsuccess = () => done(r.result);
          r.onerror = () => fail(r.error);
        });
      const db = await request(indexedDB.open(name));
      try {
        return await request(db.transaction(storeName).objectStore(storeName).get(id));
      } finally {
        db.close();
      }
    },
    [`vistoria-${ownerId}`, store, key],
  );

/** A lista diz `total` vistorias. */
const listShows = (page, total, what) => until(async () => (await listedTotal(page)) === total, what, 120_000);

/** Abre a tela de campo da primeira vistoria da lista; devolve o id dela. */
async function openFirst(page) {
  const link = page.locator(TABLE_LINK).first();
  await link.waitFor({ state: "attached" });
  const id = new URL(await link.getAttribute("href"), base).searchParams.get("id");
  await page.evaluate((selector) => [...document.querySelectorAll(selector)].find((a) => a.checkVisibility()).click(), ROW_LINK);
  await page.getByRole("radiogroup", { name: "Condição: Piso" }).waitFor();
  return id;
}

/** O item "Piso" do primeiro ambiente, como o servidor o tem. */
async function serverFloor(user, id) {
  const { status, body } = await callApi(`/api/v1/inspections/${id}`, {
    headers: { authorization: `Bearer ${user.token}` },
  });
  assert.equal(status, 200, `o GET da vistoria respondeu ${status}`);
  return { version: body.version, condition: body.rooms[0].items.find((item) => item.name === "Piso").condition };
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const server = await serve();
const newOut = join(root, "apps", "web", "out");
const browser = await launch();
try {
  const current = currentDbVersion();
  step(1, `O build de ${options.from.slice(0, 12)} (banco na versão ${current - 1}) baixa tudo e guarda uma marcação sem enviar`);
  const oldOut = oldBuild(options.from);
  const password = devPassword();
  const user = { email: DEV_EMAIL, password, ...(await apiSignIn({ email: DEV_EMAIL, password })) };
  const total = (await serverInspections(user)).length;
  assert.ok(total > 0, "o servidor não tem vistorias do usuário de dev: rode `pnpm seed` antes");

  serveDir(oldOut);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();
  await signIn(page, user, { next: "/inspections" });
  await listShows(page, total, `o build antigo lista as ${total} vistorias`);
  await until(
    async () => (await localDb(page, user.id))?.counts.inspections === total,
    "as vistorias no banco local do build antigo",
    120_000,
  );
  const before = await localDb(page, user.id);
  assert.equal(
    before.version,
    current - 1,
    `o build de origem está com o banco na versão ${before.version}, e este build é a ${current}: aponte o PREVIOUS_REF ` +
      `de scripts/volume-spike/migration-spike.mjs para o último commit da versão ${current - 1}`,
  );
  // Da 5 para a 6, o resumo nasce: o build de origem ainda guarda as vistorias na collection IndexedDB do TanStack DB.
  if (before.version === 5) {
    assert.ok(!before.stores.includes("inspectionSummaries"), "o build antigo não tem a store de resumos");
    assert.ok(before.versions.includes("inspections"), "a collection IndexedDB antiga guarda as vistorias no _versions");
  }
  ok(`banco na versão ${before.version}: ${before.counts.inspections} vistorias`);

  // O envio da vistoria barrado até o passo 4: a marcação fica na outbox do build antigo, e o build novo é quem a envia.
  // Só o `PUT`: a sessão e o pull seguem, como com a rede boa e o servidor recusando a conexão do envio.
  const SENDS = "**/api/v1/inspections/*";
  await context.route(SENDS, (route) =>
    route.request().method() === "PUT" ? route.abort("connectionrefused") : route.continue(),
  );
  const id = await openFirst(page);
  const was = await serverFloor(user, id);
  const condition = was.condition === "good" ? "poor" : "good";
  await mark(page, "Piso", CONDITIONS[condition]);
  await until(async () => (await outboxCount(page, user)) > 0, "a marcação na outbox do build antigo");
  ok(`"Piso" marcado como ${CONDITIONS[condition]} na vistoria ${id}, na outbox do build antigo`);

  step(2, "Este build no lugar: fechar e abrir o app até o service worker novo assumir");
  serveDir(newOut);
  // O tempo até a lista pronta, no relógio da página, em todo documento novo: o da abertura que migrar é o da migração.
  await markListReady(context, Math.min(total, 50));
  let migrated;
  for (let attempt = 1; attempt <= 5 && !migrated; attempt++) {
    await page.close();
    page = await context.newPage();
    await page.goto(new URL("/inspections", base).href);
    await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor({ timeout: 60_000 });
    // O build novo abre o banco logo depois do shell: espera um pouco antes de concluir que ainda é o antigo.
    const db = await until(async () => (await localDb(page, user.id))?.version === current, "o banco subiu", 5_000)
      .then(() => localDb(page, user.id))
      .catch(() => null);
    if (db?.version === current) migrated = { db, attempt };
    else await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update())).catch(() => {});
  }
  assert.ok(migrated, "o build novo não assumiu depois de fechar e abrir o app 5 vezes");
  ok(`o service worker novo assumiu na ${migrated.attempt}ª abertura, e o banco subiu para a versão ${current}`);

  step(3, "A migração: cada vistoria com o seu resumo, os roteiros pelo pull, e a lista abre com todas");
  await listShows(page, total, `o build novo lista as ${total} vistorias`);
  const listedIn = await pageValue(page, "__listReadyAt", "a lista pronta depois da migração");
  const after = await localDb(page, user.id);
  assert.equal(after.counts.inspections, total, "as vistorias continuam no banco");
  assert.equal(after.counts.inspectionSummaries, total, "um resumo por vistoria");
  assert.ok(!after.versions.includes("inspections"), "o _versions não guarda mais as vistorias");
  assert.equal(await outboxCount(page, user), 1, "a marcação do build antigo continua na outbox");
  ok(`${after.counts.inspectionSummaries} resumos; a lista abriu em ${Math.round(listedIn)} ms desde a navegação`);
  // Da 6 para a 7, a store de roteiros nasce vazia, e o pull traz o "Apartamento" do `pnpm seed`.
  if (current === 7) {
    assert.ok(!before.stores.includes("templates"), "o build antigo não tem a store de roteiros");
    const templates = await serverTemplates(user);
    assert.ok(templates.length > 0, "o servidor não tem roteiros do usuário de dev: rode `pnpm seed` antes");
    await until(
      async () => (await localDb(page, user.id))?.counts.templates === templates.length,
      "os roteiros no banco local",
      60_000,
    );
    ok(`${templates.length} roteiro(s) pelo pull: ${templates.map((template) => template.name).join(", ")}`);
  }

  step(4, "O envio liberado: a marcação do build antigo sai e entra na vistoria e no resumo juntos");
  await context.unroute(SENDS);
  // A volta da rede zera o backoff da outbox, que chega a 60 s depois de tantas recusas.
  await context.setOffline(true);
  await wait(300);
  await context.setOffline(false);
  await until(async () => (await serverFloor(user, id)).condition === condition, "a marcação no servidor", 120_000);
  await until(async () => (await outboxCount(page, user)) === 0, "a outbox vazia", 60_000);
  const sent = await serverFloor(user, id);
  await until(
    async () => (await localRecord(page, user.id, "inspectionSummaries", id))?.version === sent.version,
    "o resumo com a versão do servidor",
  );
  const record = await localRecord(page, user.id, "inspections", id);
  assert.equal(record.version, sent.version, "a vistoria com a versão do servidor");
  assert.equal(record.rooms[0].items.find((item) => item.name === "Piso").condition, condition);
  ok(`o servidor e o aparelho na versão ${sent.version}, com "Piso" ${CONDITIONS[condition]}`);

  step(5, "Modo avião: o reload abre a lista e a tela de campo com a marcação");
  const cdp = await context.newCDPSession(page);
  await setOffline(context, cdp, true);
  await page.reload();
  await listShows(page, total, "offline, a lista com todas");
  assert.ok(!new URL(page.url()).pathname.startsWith("/login"), "o reload offline não vai para o /login");
  await page.goto(new URL(`/inspections/edit?id=${id}`, base).href);
  const chip = page.getByRole("radiogroup", { name: "Condição: Piso" }).getByRole("radio", { name: CONDITIONS[condition] });
  await chip.waitFor();
  assert.equal(await chip.getAttribute("aria-checked"), "true", "a tela de campo mostra a marcação");
  ok("offline, a lista diz todas, e a tela de campo abre com a marcação");

  console.log("\nRoteiro concluído.");
} catch (error) {
  printTrace();
  throw error;
} finally {
  await browser.close();
  server.close();
}
