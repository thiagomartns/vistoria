import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rscRouteOf } from "./lib.mjs";

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
