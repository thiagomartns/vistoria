import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  candidateFiles,
  markdownTable,
  parseArgs,
  publishPath,
  rawUrl,
  routeSlug,
  screenshotName,
} from "./lib.mjs";

describe("candidateFiles", () => {
  it("serve a raiz pelo index.html", () => {
    assert.deepEqual(candidateFiles("/"), ["index.html"]);
  });

  it("tenta rota.html e rota/index.html, ignorando a query", () => {
    assert.deepEqual(candidateFiles("/inspections/edit?id=1"), [
      "inspections/edit.html",
      "inspections/edit/index.html",
    ]);
  });

  it("serve arquivos com extensão como estão", () => {
    assert.deepEqual(candidateFiles("/_next/static/app.js"), ["_next/static/app.js"]);
  });
});

describe("nomes dos prints", () => {
  it("gera um slug por rota, com a query", () => {
    assert.equal(routeSlug("/inspections/edit?id=1"), "inspections-edit-id-1");
    assert.equal(routeSlug("/"), "inicio");
  });

  it("nomeia por rota e viewport", () => {
    assert.equal(screenshotName("/login", "celular"), "login-celular.png");
  });
});

describe("publicação", () => {
  it("guarda os prints numa pasta por branch da issue", () => {
    assert.equal(publishPath("feat/42-tela", "login-celular.png"), "feat/42-tela/login-celular.png");
  });

  it("aponta para o raw da branch screens", () => {
    assert.equal(
      rawUrl("dono/repo", "feat/42-tela/login-celular.png"),
      "https://raw.githubusercontent.com/dono/repo/screens/feat/42-tela/login-celular.png",
    );
  });

  it("monta a tabela com uma coluna por viewport", () => {
    const table = markdownTable([{ route: "/login", urls: { celular: "c.png", desktop: "d.png" } }]);
    assert.equal(
      table,
      [
        "| Rota | Celular | Desktop |",
        "| --- | --- | --- |",
        '| `/login` | <img src="c.png" width="240"> | <img src="d.png" width="480"> |',
      ].join("\n"),
    );
  });
});

describe("parseArgs", () => {
  it("lê rotas e opções", () => {
    assert.deepEqual(parseArgs(["--", "login", "/sanjou", "--publish", "--out", "tmp"]), {
      routes: ["/login", "/sanjou"],
      publish: true,
      session: false,
      out: "tmp",
    });
  });

  it("--session: as rotas do shell com uma sessão de mentira", () => {
    assert.equal(parseArgs(["/clients", "--session"]).session, true);
  });

  it("exige ao menos uma rota", () => {
    assert.throws(() => parseArgs(["--publish"]), /Uso: pnpm screens/);
  });

  it("recusa opção desconhecida", () => {
    assert.throws(() => parseArgs(["/x", "--full"]), /Opção desconhecida/);
  });
});
