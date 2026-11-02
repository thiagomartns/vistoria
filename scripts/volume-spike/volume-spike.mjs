// `pnpm spike:volume [--inspections N]`
// Roteiro do spike 2 (#134): o usuário de dev, com as vistorias do `pnpm seed`, entra num aparelho limpo, baixa tudo
// pelo delta e abre rápido. Mede, no celular (CPU limitada 4×) e no desktop, um de cada vez:
// - o primeiro pull completo, da resposta do signin até a lista com todas as vistorias;
// - o tamanho do banco local (IndexedDB);
// - a live query da lista: da resposta do delta com uma mudança até a linha mudar;
// - a abertura do app recarregado em modo avião até a lista pronta, e a da tela de campo pela lista.
// As metas ficaram fixadas antes de medir (frontend.md, Spike 2); uma meta não cumprida quebra o roteiro, menos a do
// reload offline, pendente na #154 (ADR 0047).
// `--inspections` é o mínimo de vistorias vivas que o servidor precisa ter (10 mil por padrão; o CI roda com 200).
// Exige `pnpm db:up`, `pnpm dev:api`, `pnpm seed -- --inspections N` e `pnpm --filter web build`.
// A senha do usuário de dev vem de DEV_USER_PASSWORD ou do infra/.env, nunca impressa (ADR 0025).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readEnvValue } from "../db-init/lib.mjs";
import {
  base,
  callApi,
  launch,
  ok,
  printTrace,
  root,
  serve,
  signIn,
  step,
  until,
  uuidv7,
  wait,
} from "../outbox-spike/lib.mjs";

const DEV_EMAIL = "dev@vistoria.local";
const RUNS = 3;
const MB = 1024 * 1024;

/**
 * As metas, por aparelho. Fixadas antes da primeira medida (#134): não se ajustam ao número. Uma meta com `pending`
 * ainda não é cumprida, e a issue dela a cumpre (ADR 0047): o roteiro a imprime, com ✗ se for o caso, sem quebrar.
 */
const TARGETS = {
  firstPull: { label: "Primeiro pull completo", unit: "ms", phone: 120_000, desktop: 60_000 },
  database: { label: "Banco local (IndexedDB)", unit: "bytes", phone: 100 * MB, desktop: 100 * MB },
  liveQuery: { label: "Live query (delta → linha)", unit: "ms", phone: 500, desktop: 200 },
  reload: { label: "Reload offline → lista pronta", unit: "ms", phone: 2000, desktop: 1000, pending: "#154" },
  field: { label: "Lista → tela de campo", unit: "ms", phone: 1000, desktop: 500 },
};

const KIND_LABELS = { moveIn: "Entrada", moveOut: "Saída" };

const DEVICES = [
  {
    name: "phone",
    title: "celular (390×844, CPU 4×)",
    cpu: 4,
    options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  },
  { name: "desktop", title: "desktop (1440×900)", cpu: 1, options: { viewport: { width: 1440, height: 900 } } },
];

/** Os links de tela de campo da lista: um por vistoria na Table, montada também no celular (escondida), e outro na ListRow. */
const ROW_LINK = 'a[href*="/inspections/edit?id="]';
/** Um por vistoria: o da linha da Table. */
const TABLE_LINK = `tbody ${ROW_LINK}`;

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  let inspections = 10_000;
  for (let i = 0; i < args.length; i++) {
    const value = Number(args[i + 1]);
    if (args[i] !== "--inspections" || !Number.isInteger(value) || value < 1) {
      throw new Error("Uso: pnpm spike:volume [--inspections N], com N inteiro a partir de 1");
    }
    inspections = value;
    i++;
  }
  return { inspections };
}

const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const format = (value, unit) =>
  unit === "bytes" ? `${(value / MB).toFixed(1)} MB` : value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;

function devPassword() {
  if (process.env.DEV_USER_PASSWORD) return process.env.DEV_USER_PASSWORD;
  const envPath = join(root, "infra", ".env");
  const stored = existsSync(envPath) ? readEnvValue(readFileSync(envPath, "utf8"), "DEV_USER_PASSWORD") : "";
  if (!stored) throw new Error("sem DEV_USER_PASSWORD nem infra/.env com ela: rode `pnpm seed` antes.");
  return stored;
}

/** Entra pela API, esperando o Retry-After num 429 (o signin aceita 5 por minuto e IP). */
async function apiSignIn(user) {
  for (;;) {
    const res = await fetch(new URL("/api/v1/auth/signin", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    if (res.status === 429) {
      const seconds = Number(res.headers.get("retry-after") ?? 60);
      console.log(`   · signin 429 rate-limited: espera o Retry-After de ${seconds} s`);
      await wait(seconds * 1000);
      continue;
    }
    assert.equal(res.status, 200, `o signin pela API respondeu ${res.status}: rode \`pnpm seed\` antes`);
    const body = await res.json();
    return { id: body.user.id, token: body.accessToken };
  }
}

/** As vistorias vivas do servidor: o primeiro sync, sem cursor, até o fim. */
async function serverInspections(user) {
  const items = [];
  let cursor;
  for (;;) {
    const query = new URLSearchParams({ limit: "1000", ...(cursor ? { cursor } : {}) });
    const { status, body } = await callApi(`/api/v1/sync/inspections?${query}`, {
      headers: { authorization: `Bearer ${user.token}` },
    });
    assert.equal(status, 200, `o delta de vistorias respondeu ${status}`);
    items.push(...body.items);
    if (!body.hasMore) return items;
    cursor = body.nextCursor;
  }
}

/** Outro aparelho troca o tipo da vistoria (Entrada ↔ Saída), um PUT direto na API; devolve o rótulo novo. */
async function toggleKind(user, id) {
  const auth = { authorization: `Bearer ${user.token}` };
  const { body: seen } = await callApi(`/api/v1/inspections/${id}`, { headers: auth });
  const kind = seen.kind === "moveIn" ? "moveOut" : "moveIn";
  const { status } = await callApi(`/api/v1/inspections/${id}`, {
    method: "PUT",
    headers: { ...auth, "if-match": `"${seen.version}"`, "idempotency-key": uuidv7() },
    body: JSON.stringify({
      propertyId: seen.propertyId,
      kind,
      status: seen.status,
      startedAt: seen.startedAt,
      generalNotes: seen.generalNotes,
      rooms: seen.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        position: room.position,
        notes: room.notes,
        items: room.items.map(({ id: itemId, name, position, condition, notes }) => ({
          id: itemId,
          name,
          position,
          condition,
          notes,
        })),
      })),
    }),
  });
  assert.equal(status, 200, `o PUT do outro aparelho respondeu ${status}`);
  return KIND_LABELS[kind];
}

/** As linhas que a lista montou. */
const listedCount = (page) => page.evaluate((selector) => document.querySelectorAll(selector).length, TABLE_LINK);

/** Quantas vistorias distintas a lista montou, pelos links da Table e da ListRow. */
const distinctCount = (page) =>
  page.evaluate((selector) => new Set([...document.querySelectorAll(selector)].map((a) => a.getAttribute("href"))).size, ROW_LINK);

/** O total de vistorias que o contador da lista diz ("10.000 vistorias", "50 de 10.000 vistorias"), ou null. */
const listedTotal = (page) =>
  page.evaluate(() => {
    for (const p of document.querySelectorAll("main p")) {
      const match = p.textContent.match(/^(?:[\d.]+ de )?([\d.]+) vistorias?$/);
      if (match) return Number(match[1].replaceAll(".", ""));
    }
    return null;
  });

/**
 * Em todo documento novo do contexto, marca em `window.__listReadyAt` o `performance.now()` do primeiro quadro com
 * `rows` linhas na lista: depois de um reload, o tempo desde o começo da navegação. Vale a partir do próximo documento.
 */
const markListReady = (context, rows) =>
  context.addInitScript(
    ([selector, expected]) => {
      const check = () => {
        if (document.querySelectorAll(selector).length >= expected) window.__listReadyAt = performance.now();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    },
    [TABLE_LINK, rows],
  );

/** Espera um valor que a página grava em `window[name]` e o devolve. */
async function pageValue(page, name, what) {
  let value;
  await until(
    async () => (value = await page.evaluate((key) => window[key], name).catch(() => undefined)) !== undefined,
    what,
    120_000,
  );
  return value;
}

/** Guarda, na página, o `responseEnd` de cada resposta do delta de vistorias. */
const watchDeltaEnds = (page) =>
  page.evaluate(() => {
    window.__deltaEnds = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (new URL(entry.name).pathname === "/api/v1/sync/inspections") window.__deltaEnds.push(entry.responseEnd);
      }
    }).observe({ type: "resource" });
  });

/** O primeiro pull: cada resposta do `/sync/*`, com o tamanho do corpo e o `hasMore`. */
function watchSync(page) {
  const answers = [];
  page.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (!path.startsWith("/api/v1/sync/")) return;
    const entry = { path, status: res.status(), bytes: null, hasMore: null };
    answers.push(entry);
    res.body().then(
      (body) => {
        entry.bytes = body.length;
        entry.hasMore = res.ok() ? JSON.parse(body.toString()).hasMore : null;
      },
      () => (entry.bytes = 0),
    );
  });
  return answers;
}

const NETWORK = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

/**
 * Liga e desliga a rede do aparelho. Com a CPU limitada, a página tem uma sessão CDP a mais, e nela o `setOffline` do
 * contexto corta as requisições, mas deixa o `navigator.onLine` verdadeiro (e o app acha que tem rede): a sessão CDP
 * também emula a rede, para o app ver o modo avião como num aparelho de verdade.
 */
async function setOffline(context, cdp, offline) {
  await cdp?.send("Network.emulateNetworkConditions", { offline, ...NETWORK });
  await context.setOffline(offline);
}

/** Mede um aparelho do começo ao fim, num contexto limpo; devolve as medidas. */
async function measure(browser, device, user, server) {
  const results = {};
  const context = await browser.newContext(device.options);
  try {
    const page = await context.newPage();
    let cdp = null;
    if (device.cpu > 1) {
      cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: device.cpu });
      await cdp.send("Network.enable");
    }
    const sync = watchSync(page);

    // 1. Primeiro pull: do signin aceito até a lista dizer todas as vistorias do servidor.
    const signedIn = page.waitForResponse((res) => res.url().endsWith("/api/v1/auth/signin") && res.status() === 200, {
      timeout: 600_000,
    });
    await signIn(page, user, { next: "/inspections" });
    await signedIn;
    const pullStart = Date.now();
    await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
    await until(async () => (await listedTotal(page)) === server.count, "a lista com todas as vistorias", 600_000);
    results.firstPull = Date.now() - pullStart;
    await until(
      () =>
        ["clients", "properties", "inspections"].every((name) =>
          sync.some((s) => s.path.endsWith(`/${name}`) && s.status === 200 && s.hasMore === false),
        ),
      "os três laços do delta até o fim",
    );
    const rows = await listedCount(page);
    assert.ok(rows >= 1 && rows <= server.count, "a lista monta linhas");
    assert.equal(await distinctCount(page), rows, "uma linha por vistoria");
    const pages = sync.filter((s) => s.path.endsWith("/inspections")).length;
    const deltaBytes = sync.reduce((sum, s) => sum + (s.bytes ?? 0), 0);
    ok(
      `primeiro pull: a lista diz ${server.count} vistorias (${rows} linhas montadas) em ${format(results.firstPull, "ms")} ` +
        `(${sync.length} respostas do delta, ${pages} de vistorias, ${format(deltaBytes, "bytes")} de JSON)`,
    );

    // 2. O tamanho do banco local, depois de a última página assentar.
    await page.waitForLoadState("networkidle");
    await wait(1000);
    const storage = await page.evaluate(async () => {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage, ...estimate.usageDetails };
    });
    results.database = storage.indexedDB ?? storage.usage;
    ok(
      `banco local: IndexedDB ${format(results.database, "bytes")}` +
        (storage.caches !== undefined ? `, Cache Storage do service worker ${format(storage.caches, "bytes")}` : "") +
        ` (origem inteira ${format(storage.usage, "bytes")})`,
    );

    // 3. Live query: outro aparelho troca o tipo da primeira vistoria da lista; o pull da volta da rede a traz.
    const target = await page.evaluate(
      (selector) => new URL(document.querySelector(selector).href).searchParams.get("id"),
      TABLE_LINK,
    );
    await watchDeltaEnds(page);
    const liveQuery = [];
    for (let run = 0; run < RUNS; run++) {
      const label = await toggleKind(server.user, target);
      const changed = page.waitForFunction(
        ([id, expected]) => {
          const row = document.querySelector(`a[href$="id=${id}"]`)?.closest("tr");
          return row && [...row.cells].some((cell) => cell.textContent === expected) && performance.now();
        },
        [target, label],
        { polling: "raf", timeout: 60_000 },
      );
      const ends = await page.evaluate(() => window.__deltaEnds.length);
      await setOffline(context, cdp, true);
      await wait(200);
      await setOffline(context, cdp, false);
      const at = await (await changed).jsonValue();
      const end = await page.evaluate(
        ([from, until]) => window.__deltaEnds.slice(from).filter((t) => t <= until).at(-1),
        [ends, at],
      );
      assert.ok(end !== undefined, "a mudança veio pelo delta de vistorias");
      liveQuery.push(at - end);
      await page.waitForLoadState("networkidle");
    }
    results.liveQuery = median(liveQuery);
    ok(`live query: ${liveQuery.map((t) => format(t, "ms")).join(", ")} (mediana ${format(results.liveQuery, "ms")})`);

    // 4. Modo avião: recarrega até a lista pronta e abre a tela de campo pela lista.
    await markListReady(context, rows);
    await setOffline(context, cdp, true);
    const reload = [];
    const field = [];
    for (let run = 0; run < RUNS; run++) {
      await page.reload({ waitUntil: "commit" });
      reload.push(await pageValue(page, "__listReadyAt", "a lista pronta depois do reload"));
      assert.equal(await page.evaluate(() => navigator.onLine), false, "o app vê o modo avião");
      await page.evaluate((selector) => {
        const link = [...document.querySelectorAll(selector)].find((a) => a.checkVisibility());
        const opened = performance.now();
        const check = () => {
          if (document.querySelector('[role="radiogroup"][aria-label="Condição: Piso"]')) {
            window.__fieldIn = performance.now() - opened;
          } else requestAnimationFrame(check);
        };
        window.__fieldIn = undefined;
        link.click();
        requestAnimationFrame(check);
      }, ROW_LINK);
      field.push(await pageValue(page, "__fieldIn", "a tela de campo"));
      await page.getByRole("link", { name: "Voltar", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
    }
    assert.ok(await page.getByText("Você está offline").first().isVisible(), "o app está em modo avião");
    assert.ok(!new URL(page.url()).pathname.startsWith("/login"), "o reload offline não vai para o /login");
    assert.equal(await listedTotal(page), server.count, "offline, a lista diz todas as vistorias");
    results.reload = median(reload);
    results.field = median(field);
    ok(`reload offline → lista: ${reload.map((t) => format(t, "ms")).join(", ")} (mediana ${format(results.reload, "ms")})`);
    ok(`lista → tela de campo: ${field.map((t) => format(t, "ms")).join(", ")} (mediana ${format(results.field, "ms")})`);
    return results;
  } finally {
    await context.close();
  }
}

/** A tabela final: cada medida, a meta e se cumpriu. Devolve as que não cumpriram, fora as pendentes. */
function report(measured) {
  const missed = [];
  console.log("\nResultado (mediana de 3 nas medidas de tela):\n");
  console.log(`  ${"Medida".padEnd(32)}${"Celular (CPU 4×)".padEnd(30)}Desktop`);
  for (const [key, target] of Object.entries(TARGETS)) {
    const cells = DEVICES.map(({ name }) => {
      const value = measured[name][key];
      const met = value <= target[name];
      if (!met && !target.pending) {
        missed.push(`${target.label} no ${name}: ${format(value, target.unit)} > ${format(target[name], target.unit)}`);
      }
      return `${met ? "✓" : "✗"} ${format(value, target.unit)} (≤ ${format(target[name], target.unit)})`;
    });
    const note = target.pending ? `  (meta pendente, ${target.pending})` : "";
    console.log(`  ${target.label.padEnd(32)}${cells[0].padEnd(30)}${cells[1].padEnd(30)}${note}`);
  }
  return missed;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`spike:volume: ${error.message}`);
  process.exit(1);
}

const server = await serve();
const browser = await launch();
try {
  const user = { email: DEV_EMAIL, password: devPassword() };

  step(1, `Preparo: o servidor tem ao menos ${options.inspections} vistorias vivas de ${DEV_EMAIL}`);
  const apiUser = await apiSignIn(user);
  const live = await serverInspections(apiUser);
  if (live.length < options.inspections) {
    throw new Error(
      `o servidor tem ${live.length} vistorias vivas de ${DEV_EMAIL}; rode \`pnpm seed -- --inspections ${options.inspections}\`.`,
    );
  }
  const rooms = live.reduce((sum, inspection) => sum + inspection.rooms.length, 0);
  const items = live.reduce((sum, inspection) => sum + inspection.rooms.reduce((n, room) => n + room.items.length, 0), 0);
  ok(`${live.length} vistorias vivas, com ${rooms} ambientes e ${items} itens`);
  const context = { count: live.length, user: apiUser };

  const measured = {};
  let n = 1;
  for (const device of DEVICES) {
    step(++n, `${device.title}: aparelho limpo, primeiro pull, banco, live query, reload offline e tela de campo`);
    measured[device.name] = await measure(browser, device, user, context);
  }

  const missed = report(measured);
  assert.deepEqual(missed, [], `metas não cumpridas:\n  ${missed.join("\n  ")}`);
  console.log("\nRoteiro concluído.");
} catch (error) {
  printTrace();
  throw error;
} finally {
  await browser.close();
  server.close();
}
