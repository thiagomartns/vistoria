// `pnpm spike:volume [--inspections N]`
// Roteiro do spike 2 (#134): o usuário de dev, com as vistorias do `pnpm seed`, entra num aparelho limpo, baixa tudo
// pelo delta e abre rápido. Mede, no celular (CPU limitada 4×) e no desktop, um de cada vez:
// - o primeiro pull completo, da resposta do signin até a lista com todas as vistorias;
// - o tamanho do banco local (IndexedDB);
// - a live query da lista: da resposta do delta com uma mudança até a linha mudar;
// - a abertura do app recarregado em modo avião até a lista pronta, e a da tela de campo pela lista;
// - a busca e os filtros (#175), em modo avião: o reload com um filtro na URL até a lista filtrada pronta, e a busca
//   pelo nome de um cliente, da digitação até a lista só com as vistorias dele.
// As metas ficaram fixadas antes de medir (frontend.md, Spike 2); uma meta não cumprida quebra o roteiro. A do reload
// offline foi cumprida pela lista pelo resumo (#154, ADR 0048).
// `--inspections` é o mínimo de vistorias vivas que o servidor precisa ter (10 mil por padrão; o CI roda com 200).
// Exige `pnpm db:up`, `pnpm dev:api`, `pnpm seed -- --inspections N` e `pnpm --filter web build`.
// A senha do usuário de dev vem de DEV_USER_PASSWORD ou do infra/.env, nunca impressa (ADR 0025).

import assert from "node:assert/strict";

import { callApi, launch, ok, printTrace, serve, signIn, step, until, uuidv7, wait } from "../outbox-spike/lib.mjs";
import {
  DEV_EMAIL,
  ROW_LINK,
  TABLE_LINK,
  apiSignIn,
  devPassword,
  listedTotal,
  markListReady,
  pageValue,
  serverDelta,
  serverInspections,
  setOffline,
} from "./lib.mjs";

const RUNS = 3;
const MB = 1024 * 1024;

/** As metas, por aparelho. Fixadas antes da primeira medida (#134): não se ajustam ao número. */
const TARGETS = {
  firstPull: { label: "Primeiro pull completo", unit: "ms", phone: 120_000, desktop: 60_000 },
  database: { label: "Banco local (IndexedDB)", unit: "bytes", phone: 100 * MB, desktop: 100 * MB },
  liveQuery: { label: "Live query (delta → linha)", unit: "ms", phone: 500, desktop: 200 },
  reload: { label: "Reload offline → lista pronta", unit: "ms", phone: 2000, desktop: 1000 },
  field: { label: "Lista → tela de campo", unit: "ms", phone: 1000, desktop: 500 },
  // As da busca e dos filtros (#175), fixadas antes de medir: as metas da lista, a da live query e a do reload.
  filteredReload: { label: "Reload offline filtrado → lista", unit: "ms", phone: 2000, desktop: 1000 },
  search: { label: "Busca (digitação → lista)", unit: "ms", phone: 500, desktop: 200 },
};

const DEVICES = [
  {
    name: "phone",
    title: "celular (390×844, CPU 4×)",
    cpu: 4,
    options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  },
  { name: "desktop", title: "desktop (1440×900)", cpu: 1, options: { viewport: { width: 1440, height: 900 } } },
];

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

/**
 * Outro aparelho passa a vistoria para outro imóvel do mesmo dono, um PUT direto na API. Não troca o tipo: kind e
 * referência são da criação, e o PUT de atualização os ignora (ADR 0051).
 */
async function moveToAnotherProperty(user, id) {
  const auth = { authorization: `Bearer ${user.token}` };
  const { body: seen } = await callApi(`/api/v1/inspections/${id}`, { headers: auth });
  const { body: properties } = await callApi("/api/v1/sync/properties?limit=2", { headers: auth });
  const other = properties.items.find((property) => property.id !== seen.propertyId);
  assert.ok(other, "o dev@vistoria.local tem outro imóvel para a vistoria");
  const { status } = await callApi(`/api/v1/inspections/${id}`, {
    method: "PUT",
    headers: { ...auth, "if-match": `"${seen.version}"`, "idempotency-key": uuidv7() },
    body: JSON.stringify({
      propertyId: other.id,
      kind: seen.kind,
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
}

/** Sem acento e sem caixa, como a busca do app (`shared/search.ts`). */
const fold = (value) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

/**
 * O nome da busca: o de cliente com mais vistorias concluídas, entre os que não aparecem dentro de outro nome nem de um
 * endereço (a busca casaria com eles também). O seed repete nomes (500 clientes de 224 nomes), então o nome vale por
 * todos os clientes que o têm. Devolve o nome, quantas concluídas casam com ele e quantas concluídas o aparelho tem.
 */
async function searchTarget(user) {
  const [clients, properties, inspections] = await Promise.all([
    serverDelta(user, "clients"),
    serverDelta(user, "properties"),
    serverInspections(user),
  ]);
  const nameOf = new Map(clients.map((client) => [client.id, client.name]));
  const clientOf = new Map(properties.map((property) => [property.id, property.clientId]));
  const completed = inspections.filter((inspection) => inspection.status === "completed");
  const addresses = properties.map((property) => fold([property.street, property.number, property.complement].join(" ")));
  const names = [...new Set(clients.map((client) => client.name))];
  const counts = new Map();
  for (const inspection of completed) {
    const name = nameOf.get(clientOf.get(inspection.propertyId));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const unique = names.filter(
    (name) =>
      !names.some((other) => other !== name && fold(other).includes(fold(name))) &&
      !addresses.some((address) => address.includes(fold(name))),
  );
  const best = unique.toSorted((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
  assert.ok(best && counts.get(best), "há um nome de cliente com vistorias concluídas e único para a busca");
  return { name: best, matches: counts.get(best), completed: completed.length };
}

/** As linhas que a lista montou. */
const listedCount = (page) => page.evaluate((selector) => document.querySelectorAll(selector).length, TABLE_LINK);

/** Quantas vistorias distintas a lista montou, pelos links da Table e da ListRow. */
const distinctCount = (page) =>
  page.evaluate((selector) => new Set([...document.querySelectorAll(selector)].map((a) => a.getAttribute("href"))).size, ROW_LINK);

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

    // 3. Live query: outro aparelho troca o imóvel da primeira vistoria da lista; o pull da volta da rede traz o
    // endereço novo para a linha.
    const target = await page.evaluate(
      (selector) => new URL(document.querySelector(selector).href).searchParams.get("id"),
      TABLE_LINK,
    );
    await watchDeltaEnds(page);
    const liveQuery = [];
    for (let run = 0; run < RUNS; run++) {
      const before = await page.evaluate(
        (id) => document.querySelector(`a[href$="id=${id}"]`)?.closest("tr")?.cells[0].textContent,
        target,
      );
      assert.ok(before, "a linha da vistoria tem endereço");
      await moveToAnotherProperty(server.user, target);
      const changed = page.waitForFunction(
        ([id, previous]) => {
          const now = document.querySelector(`a[href$="id=${id}"]`)?.closest("tr")?.cells[0].textContent;
          return now && now !== previous && performance.now();
        },
        [target, before],
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

    // 5. Busca e filtros (#175), ainda em modo avião. O reload com `?status=completed&q=<cliente>` até a lista
    // filtrada pronta; depois, com o Status ainda em "Concluída", a busca apagada e escrita de novo, do evento de
    // input até a lista só com as vistorias do cliente e o contador certo.
    const wanted = await searchTarget(server.user);
    const filteredRows = Math.min(wanted.matches, 50);
    await markListReady(context, filteredRows, "__filteredReadyAt");
    const filteredUrl = `/inspections?status=completed&q=${encodeURIComponent(wanted.name)}`;
    const filteredReload = [];
    const search = [];
    for (let run = 0; run < RUNS; run++) {
      await page.goto(new URL(filteredUrl, page.url()).href, { waitUntil: "commit" });
      filteredReload.push(await pageValue(page, "__filteredReadyAt", "a lista filtrada depois do reload"));
      await until(async () => (await listedTotal(page)) === wanted.matches, "o contador da lista filtrada");
      // Sem a busca: só o filtro de status.
      await page.getByRole("searchbox", { name: "Buscar vistorias" }).fill("");
      await until(async () => (await listedTotal(page)) === wanted.completed, "a lista só com as concluídas");
      search.push(
        await page.evaluate(
          ([name, total, rows]) =>
            new Promise((resolve) => {
              const input = document.querySelector('input[aria-label="Buscar vistorias"]');
              const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
              const done = () => {
                const lines = [...document.querySelectorAll("tbody tr")];
                // O contador, como o `listedTotal` o lê: "12 vistorias", "50 de 1.234 vistorias".
                const count = [...document.querySelectorAll("main p")].some((p) => {
                  const match = p.textContent.match(/^(?:[\d.]+ de )?([\d.]+) vistorias?$/);
                  return match && Number(match[1].replaceAll(".", "")) === total;
                });
                return count && lines.length === rows && lines.every((tr) => tr.cells[1].textContent === name);
              };
              const typed = performance.now();
              setValue.call(input, name);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              const check = () => (done() ? resolve(performance.now() - typed) : requestAnimationFrame(check));
              requestAnimationFrame(check);
            }),
          [wanted.name, wanted.matches, filteredRows],
        ),
      );
    }
    assert.equal(await listedTotal(page), wanted.matches, "a lista filtrada diz as concluídas do cliente");
    assert.ok(new URL(page.url()).search.includes("status=completed"), "o filtro segue na URL");
    results.filteredReload = median(filteredReload);
    results.search = median(search);
    ok(
      `busca por "${wanted.name}" com Status "Concluída": ${wanted.matches} de ${wanted.completed} concluídas ` +
        `(${server.count} vistorias)`,
    );
    ok(
      `reload offline filtrado → lista: ${filteredReload.map((t) => format(t, "ms")).join(", ")} ` +
        `(mediana ${format(results.filteredReload, "ms")})`,
    );
    ok(`busca → lista: ${search.map((t) => format(t, "ms")).join(", ")} (mediana ${format(results.search, "ms")})`);
    return results;
  } finally {
    await context.close();
  }
}

/** A tabela final: cada medida, a meta e se cumpriu. Devolve as que não cumpriram. */
function report(measured) {
  const missed = [];
  console.log("\nResultado (mediana de 3 nas medidas de tela):\n");
  console.log(`  ${"Medida".padEnd(32)}${"Celular (CPU 4×)".padEnd(30)}Desktop`);
  for (const [key, target] of Object.entries(TARGETS)) {
    const cells = DEVICES.map(({ name }) => {
      const value = measured[name][key];
      const met = value <= target[name];
      if (!met) {
        missed.push(`${target.label} no ${name}: ${format(value, target.unit)} > ${format(target[name], target.unit)}`);
      }
      return `${met ? "✓" : "✗"} ${format(value, target.unit)} (≤ ${format(target[name], target.unit)})`;
    });
    console.log(`  ${target.label.padEnd(32)}${cells[0].padEnd(30)}${cells[1]}`);
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
    step(
      ++n,
      `${device.title}: aparelho limpo, primeiro pull, banco, live query, reload offline, tela de campo e busca`,
    );
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
