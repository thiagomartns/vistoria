import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LISTS,
  editorProblems,
  fieldProblems,
  listProblems,
  overflowProblems,
  screenName,
  tableProblems,
} from "./lib.mjs";

const clients = LISTS.find((list) => list.route === "/clients");

const header = (text, width, visible = true) => ({ text, width, visible });

describe("overflowProblems", () => {
  it("aceita a tela sem nada passando da borda", () => {
    assert.deepEqual(overflowProblems({ pageScrolls: false, outside: [] }), []);
  });

  it("acusa a rolagem da página e o que passa da borda (o Novo imóvel a 768 px, antes da #208)", () => {
    assert.deepEqual(overflowProblems({ pageScrolls: true, outside: [{ text: "Novo imóvel", by: 6 }] }), [
      "a página rola na horizontal",
      '"Novo imóvel" passa 6 px da borda',
    ]);
  });
});

describe("listProblems", () => {
  it("abaixo de 1024 px, exige a lista do celular", () => {
    assert.deepEqual(listProblems({ table: null, rows: 50 }, { width: 768, columns: clients.columns }), []);
    const table = { headers: [header("Nome", 200)], spills: [] };
    assert.deepEqual(listProblems({ table, rows: 0 }, { width: 768, columns: clients.columns }), [
      "abaixo de 1024 px a lista devia ser a do celular, e é a tabela",
      "a lista do celular não tem linhas visíveis",
    ]);
  });

  it("a partir de 1024 px, exige a tabela", () => {
    assert.deepEqual(listProblems({ table: null, rows: 50 }, { width: 1024, columns: clients.columns }), [
      "a partir de 1024 px a lista devia ser a tabela",
    ]);
  });
});

describe("tableProblems", () => {
  it("aceita a tabela com as colunas secundárias escondidas e a primeira legível", () => {
    const table = {
      headers: [
        header("Nome", 294),
        header("CPF ou CNPJ", 0, false),
        header("E-mail", 0, false),
        header("Telefone", 160),
        header("Imóveis", 100),
        header("Sincronização", 180),
      ],
      spills: [],
    };
    assert.deepEqual(tableProblems(table, { width: 1024, columns: clients.columns }), []);
  });

  it("acusa a primeira coluna espremida e o cabeçalho que passa por cima do vizinho (o defeito da #208)", () => {
    const table = {
      headers: clients.columns.map((text, i) => header(text, i === 0 ? 0 : 180)),
      spills: [{ text: "Nome", column: "Nome" }],
    };
    assert.deepEqual(tableProblems(table, { width: 1024, columns: clients.columns }), [
      'a coluna "Nome" tem 0 px, menos que 180',
      '"Nome" passa da célula na coluna "Nome"',
    ]);
  });

  it("acusa a primeira coluna escondida", () => {
    const table = { headers: [header("Nome", 0, false), header("Imóveis", 100)], spills: [] };
    assert.deepEqual(tableProblems(table, { width: 1024, columns: clients.columns }), [
      'a primeira coluna devia ser "Nome", e é "Imóveis"',
    ]);
  });

  it("a 1440 px, exige todas as colunas do Figma", () => {
    const table = { headers: clients.columns.map((text) => header(text, 200, text !== "E-mail")), spills: [] };
    assert.deepEqual(tableProblems(table, { width: 1440, columns: clients.columns }), [
      "a 1440 px faltam colunas do Figma: E-mail",
    ]);
    assert.deepEqual(tableProblems(table, { width: 1279, columns: clients.columns }), []);
  });
});

describe("fieldProblems", () => {
  it("o layout segue a largura da StepperForm, não a da janela", () => {
    assert.deepEqual(fieldProblems({ stepper: 989, rail: false, truncatedChips: [] }), []);
    assert.deepEqual(fieldProblems({ stepper: 1078, rail: true, truncatedChips: [] }), []);
  });

  it("acusa o desktop espremido e o chip cortado (a tela de campo a 1279 px, antes da #208)", () => {
    assert.deepEqual(fieldProblems({ stepper: 989, rail: true, truncatedChips: ["Ausente"] }), [
      "com a StepperForm de 989 px, o layout devia ser o do celular",
      'o chip "Ausente" está cortado',
    ]);
  });
});

describe("editorProblems", () => {
  it("dois painéis a partir de 1024 px", () => {
    assert.deepEqual(editorProblems({ twoPanels: false }, { width: 768 }), []);
    assert.deepEqual(editorProblems({ twoPanels: true }, { width: 1024 }), []);
    assert.deepEqual(editorProblems({ twoPanels: true }, { width: 768 }), [
      "a 768 px o editor devia ter os dois níveis do celular",
    ]);
  });
});

describe("screenName", () => {
  it("dá o nome do --files do pnpm screens, só a 768, 1024 e 1440 px", () => {
    assert.equal(screenName("clients", 768), "clients-tablet.png");
    assert.equal(screenName("clients", 1024), "clients-notebook.png");
    assert.equal(screenName("clients", 1440), "clients-desktop.png");
    assert.equal(screenName("clients", 1279), null);
    assert.equal(screenName("clients", 1366), null);
  });
});
