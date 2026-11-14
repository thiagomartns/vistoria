import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LISTS, screenName, tableProblems } from "./lib.mjs";

const clients = LISTS.find((list) => list.route === "/clients");

const header = (text, width, visible = true) => ({ text, width, visible });

describe("tableProblems", () => {
  it("aceita a tabela com as colunas secundárias escondidas e a primeira legível", () => {
    const measure = {
      headers: [
        header("Nome", 198),
        header("CPF ou CNPJ", 0, false),
        header("E-mail", 0, false),
        header("Telefone", 0, false),
        header("Imóveis", 100),
        header("Sincronização", 180),
      ],
      spills: [],
      pageScrolls: false,
    };
    assert.deepEqual(tableProblems(measure, { width: 768, columns: clients.columns }), []);
  });

  it("acusa a primeira coluna espremida e o cabeçalho que passa por cima do vizinho (o defeito da #208)", () => {
    const measure = {
      headers: clients.columns.map((text, i) => header(text, i === 0 ? 0 : 180)),
      spills: [{ text: "Nome", column: "Nome" }],
      pageScrolls: false,
    };
    assert.deepEqual(tableProblems(measure, { width: 1024, columns: clients.columns }), [
      'a coluna "Nome" tem 0 px, menos que 180',
      '"Nome" passa da célula na coluna "Nome"',
    ]);
  });

  it("acusa a primeira coluna escondida", () => {
    const measure = {
      headers: [header("Nome", 0, false), header("Imóveis", 100)],
      spills: [],
      pageScrolls: false,
    };
    assert.deepEqual(tableProblems(measure, { width: 768, columns: clients.columns }), [
      'a primeira coluna devia ser "Nome", e é "Imóveis"',
    ]);
  });

  it("acusa a rolagem da página, fora da borda", () => {
    const measure = { headers: [header("Nome", 200)], spills: [], pageScrolls: true };
    assert.deepEqual(tableProblems(measure, { width: 768, columns: clients.columns }), [
      "a página rola na horizontal: a rolagem tem de ficar dentro da borda",
    ]);
  });

  it("a 1440 px, exige todas as colunas do Figma", () => {
    const measure = {
      headers: clients.columns.map((text) => header(text, 200, text !== "E-mail")),
      spills: [],
      pageScrolls: false,
    };
    assert.deepEqual(tableProblems(measure, { width: 1440, columns: clients.columns }), [
      "a 1440 px faltam colunas do Figma: E-mail",
    ]);
    assert.deepEqual(tableProblems(measure, { width: 1279, columns: clients.columns }), []);
  });
});

describe("screenName", () => {
  it("dá o nome do --files do pnpm screens, sem print a 1279 px", () => {
    assert.equal(screenName("/clients", 768), "clients-tablet.png");
    assert.equal(screenName("/clients", 1024), "clients-notebook.png");
    assert.equal(screenName("/clients", 1440), "clients-desktop.png");
    assert.equal(screenName("/clients", 1279), null);
  });
});
