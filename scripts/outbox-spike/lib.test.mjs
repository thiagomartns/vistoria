import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";

import { rscRouteOf, savePages } from "./lib.mjs";

const base = "http://127.0.0.1:41399";

describe("rscRouteOf", () => {
  it("dá a rota do __PAGE__ de uma rota aninhada", () => {
    assert.deepEqual(rscRouteOf(`${base}/clients/edit/__next.!KGFwcCk.clients.edit.__PAGE__.txt?_rsc=T0ETrju6demJDCT2`), {
      route: "/clients/edit",
      page: true,
    });
  });

  it("marca o _tree como outro segmento, não o __PAGE__", () => {
    assert.deepEqual(rscRouteOf(`${base}/inspections/__next._tree.txt?_rsc=J7zho40XcKFpLFOY`), {
      route: "/inspections",
      page: false,
    });
  });

  it("dá / para a raiz", () => {
    assert.deepEqual(rscRouteOf(`${base}/__next.__PAGE__.txt?_rsc=abc`), { route: "/", page: true });
  });

  it("dá a rota da página inteira, a que a navegação busca sem prefetch", () => {
    assert.deepEqual(rscRouteOf(`${base}/properties/edit.txt?_rsc=UjE7vID9ptJhCDFK`), {
      route: "/properties/edit",
      page: true,
    });
    assert.deepEqual(rscRouteOf(`${base}/index.txt?_rsc=abc`), { route: "/", page: true });
  });

  it("ignora o que não é payload RSC: a API, os chunks, o HTML e o .txt sem _rsc", () => {
    assert.equal(rscRouteOf(`${base}/api/v1/sync/clients?cursor=0`), null);
    assert.equal(rscRouteOf(`${base}/api/v1/sync/clients?_rsc=x`), null);
    assert.equal(rscRouteOf(`${base}/_next/static/chunks/app.js`), null);
    assert.equal(rscRouteOf(`${base}/clients/edit/__next.!KGFwcCk.clients.edit.__PAGE__.txt`), null);
    assert.equal(rscRouteOf(`${base}/clients/edit?id=01a1c07c`), null);
  });
});

// Um navegador falso: só o que o `savePages` usa do Playwright.
function fakePage(url, screenshot = async ({ path }) => writeFileSync(path, "png")) {
  const page = { url: () => url, locator: (selector) => ({ selector }), calls: [] };
  page.screenshot = (options) => {
    page.calls.push(options);
    return screenshot(options);
  };
  return page;
}
const fakeBrowser = (...contexts) => ({ contexts: () => contexts.map((pages) => ({ pages: () => pages })) });

async function quietly(run) {
  const log = mock.method(console, "log", () => {});
  try {
    await run();
    return log.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
  } finally {
    log.mock.restore();
  }
}

describe("savePages", () => {
  it("imprime a URL e grava o print de página inteira de cada página de cada contexto, com a senha mascarada", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "falha-")), "roteiro");
    const a = fakePage(`${base}/inspections/conflict?id=1`);
    const b = fakePage(`${base}/login?next=%2Finspections`);
    const c = fakePage(`${base}/clients`);
    const out = await quietly(() => savePages("roteiro", fakeBrowser([a, b], [c]), { dir }));

    assert.match(out, /contexto 1-p1 {2}http:\/\/127\.0\.0\.1:41399\/inspections\/conflict\?id=1/);
    assert.match(out, /contexto 1-p2 {2}.*\/login\?next=%2Finspections/);
    assert.match(out, /contexto 2-p1 {2}.*\/clients/);
    for (const [page, file] of [
      [a, "contexto-1-p1.png"],
      [b, "contexto-1-p2.png"],
      [c, "contexto-2-p1.png"],
    ]) {
      const [options] = page.calls;
      assert.equal(options.path, join(dir, file));
      assert.equal(options.fullPage, true);
      assert.deepEqual(options.mask, [{ selector: 'input[type="password"]' }]);
      assert.ok(existsSync(join(dir, file)));
    }
  });

  it("apaga os prints de uma rodada anterior", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "falha-")), "roteiro");
    await quietly(() => savePages("roteiro", fakeBrowser([fakePage(`${base}/a`)]), { dir }));
    await quietly(() => savePages("roteiro", fakeBrowser([]), { dir }));
    assert.equal(existsSync(join(dir, "contexto-1-p1.png")), false);
    assert.ok(existsSync(dir));
  });

  it("dá o nome de `named` ao rótulo e ao arquivo", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "falha-")), "v1");
    const celular = fakePage(`${base}/inspections/edit?id=1`);
    const out = await quietly(() => savePages("v1", fakeBrowser([celular]), { dir, named: { celular } }));
    assert.match(out, /celular {2}.*\/inspections\/edit\?id=1/);
    assert.equal(celular.calls[0].path, join(dir, "celular.png"));
  });

  it("não lança quando um print falha ou trava: as outras páginas saem e o prazo segura o resto", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "falha-")), "roteiro");
    const broken = fakePage(`${base}/quebrou`, async () => {
      throw new Error("Target page, context or browser has been closed\nmais linhas");
    });
    const fine = fakePage(`${base}/clients`);
    const stuck = fakePage(`${base}/travou`, () => new Promise(() => {}));
    const after = fakePage(`${base}/depois`);
    const started = Date.now();
    const out = await quietly(() =>
      savePages("roteiro", fakeBrowser([broken, fine], [stuck, after]), { dir, timeout: 200 }),
    );

    assert.ok(Date.now() - started < 2_000, "o prazo segura o print travado");
    assert.match(out, /print não saiu: Target page, context or browser has been closed$/m);
    assert.ok(existsSync(join(dir, "contexto-1-p2.png")), "a página depois da que falhou ainda sai");
    assert.match(out, /contexto 2-p1 {2}.*\/travou/);
    assert.match(out, /prazo de 200 ms esgotado, com 1 print em andamento/);
  });

  it("não lança quando o navegador já fechou", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "falha-")), "roteiro");
    const closed = {
      contexts: () => {
        throw new Error("Browser has been closed");
      },
    };
    const out = await quietly(() => savePages("roteiro", closed, { dir }));
    assert.match(out, /as páginas não saíram: Browser has been closed/);
  });
});
