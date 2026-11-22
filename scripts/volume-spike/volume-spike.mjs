// `pnpm spike:volume [--inspections N]`
// Roteiro do spike 2 (#134): o usuário de dev, com as vistorias do `pnpm seed`, entra num aparelho limpo, baixa tudo
// pelo delta e abre rápido. Mede, no celular (CPU limitada 4×) e no desktop, um de cada vez:
// - o primeiro pull completo, da resposta do signin até a lista com todas as vistorias;
// - o tamanho do banco local (IndexedDB);
// - a live query da lista: da resposta do delta com uma mudança até a linha mudar;
// - a abertura do app recarregado em modo avião até a lista pronta, e a da tela de campo pela lista;
// - a busca e os filtros (#175), em modo avião: o reload com um filtro na URL até a lista filtrada pronta, e a busca
//   pelo nome de um cliente, da digitação até a lista só com as vistorias dele;
// - o filtro Imóvel (#225), com todos os imóveis do aparelho: do clique até as opções na tela (no celular, dentro do
//   Sheet "Filtros"). Com SCREENS=1, os prints do SearchSelect aberto, buscando e sem resultado, e os da Nova vistoria e
//   do formulário de imóvel, em `.screens/busca/`;
// - as listas de clientes e de imóveis (#223), em modo avião: do menu até a primeira página, e a busca, da digitação
//   até a lista só com o que casa.
// Cada lista monta só a versão da largura, a Table ou a ListRow (#223): uma com links escondidos pelo CSS também
// quebra o roteiro, no relatório final.
// As metas ficaram fixadas antes de medir (frontend.md, Spike 2); uma meta não cumprida quebra o roteiro. A do reload
// offline foi cumprida pela lista pelo resumo (#154, ADR 0048).
// `--inspections` é o mínimo de vistorias vivas que o servidor precisa ter (10 mil por padrão; o CI roda com 200).
// Exige `pnpm db:up`, `pnpm dev:api`, `pnpm seed -- --inspections N` e `pnpm --filter web build`.
// A senha do usuário de dev vem de DEV_USER_PASSWORD ou do infra/.env, nunca impressa (ADR 0025).

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  callApi,
  launch,
  ok,
  printTrace,
  root,
  savePages,
  serve,
  signIn,
  step,
  until,
  uuidv7,
  wait,
} from "../outbox-spike/lib.mjs";
import {
  DEV_EMAIL,
  ROW_LINK,
  apiSignIn,
  countLinks,
  devPassword,
  listedTotal,
  markListReady,
  pageValue,
  serverDelta,
  serverInspections,
  setOffline,
} from "./lib.mjs";

const RUNS = 3;

/** Com SCREENS=1, os prints do SearchSelect (#225), com os dados do seed. */
const shotsDir = process.env.SCREENS ? resolve(process.env.INIT_CWD ?? root, ".screens/busca") : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const shoot = async (page, device, name) => {
  // O `pnpm screens --files` lê `<nome>-celular.png` e `<nome>-desktop.png`.
  const suffix = device === "phone" ? "celular" : device;
  if (shotsDir) await page.screenshot({ path: resolve(shotsDir, `busca-${name}-${suffix}.png`) });
};

/**
 * Do clique no filtro Imóvel visível (a barra no desktop, o painel do Sheet no celular) até a primeira opção depois do
 * "Todos" na tela; devolve o tempo e quantas opções a lista montou.
 */
const openPropertyFilter = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const trigger = [...document.querySelectorAll('button[aria-label="Filtrar por imóvel"]')].find((button) =>
          button.checkVisibility(),
        );
        const clicked = performance.now();
        trigger.click();
        const check = () => {
          const options = document.querySelectorAll('[role="listbox"] [role="option"]');
          if (options.length > 1 && options[1].checkVisibility()) {
            done({ ms: performance.now() - clicked, options: options.length });
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
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
  // A do filtro Imóvel (#225), fixada antes de medir: o SearchSelect monta no máximo 50 opções.
  propertyFilter: { label: "Filtro Imóvel (clique → opções)", unit: "ms", phone: 300, desktop: 150 },
  // As das listas de cadastro (#223), fixadas antes de medir: a de "Lista → tela de campo" para abrir pelo menu, e a da
  // busca de /inspections para a busca.
  clientsOpen: { label: "Menu → lista de clientes", unit: "ms", phone: 1000, desktop: 500 },
  clientsSearch: { label: "Busca de clientes → lista", unit: "ms", phone: 500, desktop: 200 },
  propertiesOpen: { label: "Menu → lista de imóveis", unit: "ms", phone: 1000, desktop: 500 },
  propertiesSearch: { label: "Busca de imóveis → lista", unit: "ms", phone: 500, desktop: 200 },
};

/** O endereço de um imóvel como a lista o mostra (`addressOf`, em properties.view.ts). */
const addressOf = (property) =>
  `${property.street}, ${property.number}` + (property.complement ? ` · ${property.complement}` : "");

/**
 * As listas de cadastro (#223): o item do menu, o link de cada linha, a busca e o que ela acha. `target` escolhe o
 * texto da busca e devolve quantos registros casam com ele, pela regra do app (`matchesSearch` de cada view), entre 1 e
 * 49, para a lista filtrada caber na primeira página e não ser a primeira página inteira.
 */
const REGISTRIES = [
  {
    key: "clients",
    title: "Clientes",
    link: 'a[href*="/clients/edit?id="]',
    search: "Buscar clientes",
    target: ({ clients }) => {
      // Um nome (com letras) nunca casa com o documento nem com o telefone, só com o nome e o e-mail.
      const matches = (query) =>
        clients.filter((client) => fold(client.name).includes(query) || fold(client.email ?? "").includes(query)).length;
      const names = [...new Set(clients.map((client) => client.name))].toSorted();
      for (const name of names) {
        const found = matches(fold(name));
        if (found >= 1 && found < 50) return { query: name, found };
      }
      throw new Error("nenhum nome de cliente acha entre 1 e 49 clientes");
    },
  },
  {
    key: "properties",
    title: "Imóveis",
    link: 'a[href*="/properties/edit?id="]',
    search: "Buscar imóveis",
    target: ({ propertyList }) => {
      const matches = (query) =>
        propertyList.filter((property) =>
          [addressOf(property), property.district, property.city].some((field) => fold(field).includes(query)),
        ).length;
      for (const property of propertyList) {
        const found = matches(fold(addressOf(property)));
        if (found >= 1 && found < 50) return { query: addressOf(property), found };
      }
      throw new Error("nenhum endereço acha entre 1 e 49 imóveis");
    },
  },
];

/**
 * Do clique no item `title` do menu visível até `expected` linhas montadas na lista. Conta os links montados, não os
 * visíveis: conferir a visibilidade de milhares de links a cada quadro pesaria na própria medida, e o React monta a
 * lista inteira num commit só.
 */
const openFromMenu = (page, title, selector, expected) =>
  page.evaluate(
    ([name, links, rows]) =>
      new Promise((done) => {
        const item = [...document.querySelectorAll('nav[aria-label="Principal"] a')].find(
          (a) => a.textContent.trim() === name && a.checkVisibility(),
        );
        const clicked = performance.now();
        item.click();
        const check = () =>
          document.querySelectorAll(links).length >= rows ? done(performance.now() - clicked) : requestAnimationFrame(check);
        requestAnimationFrame(check);
      }),
    [title, selector, expected],
  );

/** Do evento de input da busca `label` com `query` até a lista com `expected` registros distintos. */
const searchList = (page, label, query, selector, expected) =>
  page.evaluate(
    ([name, text, links, rows]) =>
      new Promise((done) => {
        const input = document.querySelector(`input[aria-label="${name}"]`);
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        const ready = () => {
          const all = document.querySelectorAll(links);
          // Antes da #223, a lista tem as duas versões: até duas vezes os registros, nunca mais.
          return all.length <= rows * 2 && new Set([...all].map((a) => a.getAttribute("href"))).size === rows;
        };
        const typed = performance.now();
        setValue.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const check = () => (ready() ? done(performance.now() - typed) : requestAnimationFrame(check));
        requestAnimationFrame(check);
      }),
    [label, query, selector, expected],
  );

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

/** Quantas vistorias distintas a lista mostra, pelos links visíveis da Table ou da ListRow. */
const distinctCount = (page) =>
  page.evaluate(
    (selector) =>
      new Set([...document.querySelectorAll(selector)].filter((a) => a.checkVisibility()).map((a) => a.getAttribute("href")))
        .size,
    ROW_LINK,
  );

/**
 * A lista montou só a versão da largura (#223): nenhum link escondido pelo CSS. Devolve o problema, ou null; o
 * relatório final junta os problemas com as metas não cumpridas.
 */
const oneVersion = (what, device, { visible, mounted }) =>
  mounted === visible ? null : `${what} no ${device}: ${mounted} links montados para ${visible} visíveis (duas versões)`;

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
    const links = await countLinks(page);
    const rows = links.visible;
    assert.ok(rows >= 1 && rows <= server.count, "a lista monta linhas");
    assert.equal(await distinctCount(page), rows, "uma linha por vistoria");
    results.problems = [oneVersion("/inspections", device.name, links)].filter(Boolean);
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
      (selector) =>
        new URL([...document.querySelectorAll(selector)].find((a) => a.checkVisibility()).href).searchParams.get("id"),
      ROW_LINK,
    );

    await watchDeltaEnds(page);
    const liveQuery = [];
    for (let run = 0; run < RUNS; run++) {
      // O texto do link visível da vistoria: o endereço na Table, a ListRow inteira no celular.
      const before = await page.evaluate(
        (id) => [...document.querySelectorAll(`a[href$="id=${id}"]`)].find((a) => a.checkVisibility())?.textContent,
        target,
      );
      assert.ok(before, "a linha da vistoria tem endereço");
      await moveToAnotherProperty(server.user, target);
      const changed = page.waitForFunction(
        ([id, previous]) => {
          const now = [...document.querySelectorAll(`a[href$="id=${id}"]`)].find((a) => a.checkVisibility())?.textContent;
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
                // As linhas visíveis: a da Table (o `tr`) ou a ListRow (o link), com o nome do cliente.
                const lines = [...document.querySelectorAll('a[href*="/inspections/edit?id="]')]
                  .filter((a) => a.checkVisibility())
                  .map((a) => a.closest("tr") ?? a);
                // O contador, como o `listedTotal` o lê: "12 vistorias", "50 de 1.234 vistorias".
                const count = [...document.querySelectorAll("main p")].some((p) => {
                  const match = p.textContent.match(/^(?:[\d.]+ de )?([\d.]+) vistorias?$/);
                  return match && Number(match[1].replaceAll(".", "")) === total;
                });
                return (
                  count &&
                  lines.length === rows &&
                  lines.every((line) => (line.cells ? line.cells[1].textContent === name : line.textContent.includes(name)))
                );
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

    // 6. O filtro Imóvel (#225), ainda em modo avião, com todos os imóveis do aparelho. No celular, dentro do Sheet
    // "Filtros"; o Esc fecha só o SearchSelect.
    await page.goto(new URL("/inspections", page.url()).href);
    await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
    await until(async () => (await listedTotal(page)) === server.count, "a lista sem filtros");
    if (device.name === "phone") {
      await page.getByRole("button", { name: /^Filtros/ }).click();
      await page.getByRole("dialog", { name: "Filtros" }).waitFor();
    }
    const propertyFilter = [];
    let mounted = 0;
    for (let run = 0; run < RUNS; run++) {
      const opened = await openPropertyFilter(page);
      propertyFilter.push(opened.ms);
      mounted = opened.options;
      if (run < RUNS - 1) {
        await page.keyboard.press("Escape");
        await page.getByRole("listbox", { name: "Imóvel" }).waitFor({ state: "hidden" });
      }
    }
    const properties = server.properties;
    assert.equal(mounted, Math.min(properties, 50) + 1, "o \"Todos\" e no máximo 50 imóveis montados");
    if (properties > 50) {
      await page.getByText(`Mais ${(properties - 50).toLocaleString("pt-BR")}: refine a busca`).waitFor();
    }
    results.propertyFilter = median(propertyFilter);
    ok(
      `filtro Imóvel → opções: ${propertyFilter.map((t) => format(t, "ms")).join(", ")} ` +
        `(mediana ${format(results.propertyFilter, "ms")}; ${mounted} de ${properties + 1} opções montadas)`,
    );
    await shoot(page, device.name, "1-aberto");
    const third = await page.getByRole("option").nth(2).textContent();
    const term = third.split(",")[0].split(" ").at(-1);
    await page.keyboard.type(term);
    await until(async () => (await page.getByRole("option").count()) >= 2, `os imóveis com "${term}"`);
    await shoot(page, device.name, "2-buscando");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("rua que não existe");
    await page.getByText("Nenhum imóvel encontrado").waitFor();
    await shoot(page, device.name, "3-sem-resultado");
    await page.keyboard.press("Escape");
    if (shotsDir) {
      if (device.name === "phone") await page.keyboard.press("Escape");
      // A Nova vistoria e o formulário de imóvel, com o campo aberto.
      await page.goto(new URL("/inspections/new", page.url()).href);
      await page.getByLabel("Imóvel", { exact: true }).click();
      await page.getByRole("listbox", { name: "Imóvel" }).waitFor();
      await shoot(page, device.name, "4-nova-vistoria");
      await page.goto(new URL("/properties/edit", page.url()).href);
      await page.getByLabel("Cliente", { exact: true }).click();
      await page.getByRole("listbox", { name: "Cliente" }).waitFor();
      await shoot(page, device.name, "5-imovel-cliente");
    }

    // 7. As listas de clientes e de imóveis (#223), ainda em modo avião: do menu até a primeira página na tela, e a
    // busca, da digitação até só os registros que casam. O "Mostrar mais" e as linhas no DOM saem só como informação.
    for (const registry of REGISTRIES) {
      const total = registry.key === "clients" ? server.clients.length : server.propertyList.length;
      const firstPage = Math.min(total, 50);
      await page.goto(new URL("/inspections", page.url()).href);
      await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
      const open = [];
      for (let run = 0; run < RUNS; run++) {
        open.push(await openFromMenu(page, registry.title, registry.link, firstPage));
        await page.getByRole("heading", { level: 1, name: registry.title }).waitFor();
        if (run < RUNS - 1) {
          await page.locator('nav[aria-label="Principal"] a').filter({ hasText: "Vistorias", visible: true }).click();
          await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
        }
      }
      const links = await countLinks(page, registry.link);
      const problem = oneVersion(`/${registry.key}`, device.name, links);
      if (problem) results.problems.push(problem);
      results[`${registry.key}Open`] = median(open);
      ok(
        `menu → ${registry.title.toLowerCase()}: ${open.map((t) => format(t, "ms")).join(", ")} ` +
          `(mediana ${format(results[`${registry.key}Open`], "ms")}; ${links.mounted} links montados, ` +
          `${links.visible} visíveis, de ${total} registros)`,
      );

      const more = page.getByRole("button", { name: "Mostrar mais" });
      if (await more.isVisible()) {
        const shown = Math.min(total, 100);
        const clicked = Date.now();
        await more.click();
        await until(async () => (await countLinks(page, registry.link)).visible >= shown, "a segunda página");
        ok(`"Mostrar mais": ${shown} linhas em ${format(Date.now() - clicked, "ms")} (informação, sem meta)`);
      }

      const { query, found } = registry.target(server);
      const box = page.getByRole("searchbox", { name: registry.search });
      const search = [];
      for (let run = 0; run < RUNS; run++) {
        await box.fill("");
        await until(
          async () => (await countLinks(page, registry.link)).visible >= firstPage,
          `a lista de ${registry.title.toLowerCase()} sem busca`,
        );
        search.push(await searchList(page, registry.search, query, registry.link, found));
      }
      results[`${registry.key}Search`] = median(search);
      ok(
        `busca de ${registry.title.toLowerCase()} por "${query}" (${found} de ${total}): ` +
          `${search.map((t) => format(t, "ms")).join(", ")} (mediana ${format(results[`${registry.key}Search`], "ms")})`,
      );
    }
    return results;
  } finally {
    await context.close();
  }
}

/** A tabela final: cada medida, a meta e se cumpriu. Devolve as que não cumpriram, e as listas com duas versões. */
function report(measured) {
  const missed = DEVICES.flatMap(({ name }) => measured[name].problems);
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
  const propertyList = (await serverDelta(apiUser, "properties")).filter((property) => !property.deletedAt);
  const clients = (await serverDelta(apiUser, "clients")).filter((client) => !client.deletedAt);
  const context = { count: live.length, properties: propertyList.length, propertyList, clients, user: apiUser };

  const measured = {};
  let n = 1;
  for (const device of DEVICES) {
    step(
      ++n,
      `${device.title}: aparelho limpo, primeiro pull, banco, live query, reload offline, tela de campo, busca e cadastros`,
    );
    measured[device.name] = await measure(browser, device, user, context);
  }

  const missed = report(measured);
  assert.deepEqual(missed, [], `metas não cumpridas:\n  ${missed.join("\n  ")}`);
  console.log("\nRoteiro concluído.");
} catch (error) {
  printTrace();
  await savePages("volume", browser);
  throw error;
} finally {
  await browser.close();
  server.close();
}
