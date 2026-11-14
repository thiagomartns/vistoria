// `pnpm layout:screens`
// Roteiro da #208: as telas do app não quebram do tablet ao desktop. O usuário de dev, com os dados do `pnpm seed`,
// entra e baixa tudo; cada tela abre uma vez e passa por 768, 1024, 1279, 1366 e 1440 px trocando o viewport, sem
// recarregar (o refresh aceita 30 por minuto). Em toda tela, quebra se a página rola na horizontal ou se algo visível
// passa da borda de quem o contém, fora de uma faixa que rola de propósito e do texto com reticências. E mais
// (ADR 0061):
// - as quatro listas: a do celular abaixo de 1024 px; a tabela a partir dele, com a primeira coluna de 180 px ou mais,
//   nenhuma célula transbordando sem corte e todas as colunas do Figma a 1440 px;
// - a tela de campo, numa vistoria em andamento: o layout de desktop só com a StepperForm a partir de 1072 px, e
//   nenhum chip de condição cortado (o "Ausente" marcado, quando o seed tem um);
// - o editor de roteiro: dois painéis a partir de 1024 px (abre de novo a cada largura: o estado do celular não
//   passa para o desktop).
// Com SCREENS=1, grava os prints em `.screens/telas/`, com os nomes do `pnpm screens --files` (tablet, notebook e
// desktop). Exige `pnpm db:up`, `pnpm dev:api`, `pnpm seed` e `pnpm --filter web build`.
// A senha do usuário de dev vem de DEV_USER_PASSWORD ou do infra/.env, nunca impressa (ADR 0025).

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { base, launch, ok, printTrace, serve, signIn, step, wait } from "../outbox-spike/lib.mjs";
import { DEV_EMAIL, apiSignIn, devPassword, serverDelta } from "../volume-spike/lib.mjs";
import {
  LISTS,
  WIDTHS,
  editorProblems,
  fieldProblems,
  listProblems,
  overflowProblems,
  screenName,
} from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const shotsDir = process.env.SCREENS ? resolve(process.env.INIT_CWD ?? root, ".screens/telas") : null;

/** O que passa da borda na tela aberta (ver `overflowProblems`). Só o de mais fora: os filhos dele não repetem. */
const measureOverflow = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main");
    const outside = [];
    const flagged = [];
    for (const el of main.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      // O desenho dentro de um ícone conta pelo `svg` inteiro (o `svg` corta o que tem dentro, e a caixa seria ele).
      if (el.ownerSVGElement || rect.width === 0 || rect.height === 0 || !el.checkVisibility()) continue;
      if (flagged.some((parent) => parent.contains(el))) continue;
      let box = null;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).overflowX !== "visible") {
          box = node;
          break;
        }
      }
      // A faixa que rola de propósito (a tabela do Sanjou, os ambientes no celular) e o texto com reticências.
      if (box?.classList.contains("overflow-x-auto")) continue;
      if (box && getComputedStyle(box).textOverflow === "ellipsis") continue;
      const limit = Math.min(box ? box.getBoundingClientRect().right : Infinity, window.innerWidth);
      if (rect.right > limit + 1) {
        flagged.push(el);
        const text = (el.innerText || el.getAttribute("aria-label") || el.tagName.toLowerCase()).trim();
        outside.push({ text: text.replace(/\s+/g, " ").slice(0, 40), by: Math.round(rect.right - limit) });
      }
    }
    return { pageScrolls: document.documentElement.scrollWidth > window.innerWidth, outside: outside.slice(0, 8) };
  });

/** A lista aberta: a tabela, se visível, e as linhas do celular visíveis (ver `listProblems`). */
const measureList = (page) =>
  page.evaluate(() => {
    const element = document.querySelector("main table");
    const rows = [...document.querySelectorAll("main ul li a")].filter((a) => a.checkVisibility()).length;
    if (!element?.checkVisibility()) return { table: null, rows };
    const shown = (cell) => getComputedStyle(cell).display !== "none";
    const titles = [...element.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const headers = [...element.querySelectorAll("thead th")].map((th, i) => ({
      text: titles[i],
      width: th.getBoundingClientRect().width,
      visible: shown(th),
    }));
    const spills = [];
    for (const row of element.querySelectorAll("tr")) {
      [...row.children].forEach((cell, i) => {
        if (!shown(cell) || getComputedStyle(cell).overflowX !== "visible") return;
        if (cell.scrollWidth > cell.clientWidth + 1) {
          spills.push({ text: cell.textContent.trim().slice(0, 40), column: titles[i] });
        }
      });
    }
    return { table: { headers, spills }, rows };
  });

/** A tela de campo aberta (ver `fieldProblems`). */
const measureField = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('main nav[aria-label="Ambientes"]');
    const truncatedChips = [...document.querySelectorAll('main [role="radio"] span')]
      .filter((span) => span.checkVisibility() && span.scrollWidth > span.clientWidth + 1)
      .map((span) => span.textContent.trim());
    return {
      stepper: nav.parentElement.parentElement.getBoundingClientRect().width,
      rail: getComputedStyle(nav).flexDirection === "column",
      truncatedChips: [...new Set(truncatedChips)],
    };
  });

/** Uma vistoria em andamento, de preferência com um "Ausente" marcado no primeiro ambiente, e uma concluída. */
async function pickInspections(user) {
  const inspections = await serverDelta(user, "inspections");
  const open = inspections.filter((inspection) => inspection.status !== "completed");
  const withAbsent = open.find((inspection) =>
    inspection.rooms[0]?.items.some((item) => item.condition === "absent"),
  );
  const done = inspections.find((inspection) => inspection.status === "completed");
  assert.ok(open.length > 0 && done, "o seed tem vistorias em andamento e concluídas");
  return { open: withAbsent ?? open[0], done };
}

const failures = [];

/** Passa a tela aberta pelas larguras: confere, imprime e guarda o print. `reopen` abre de novo a cada largura. */
async function check(page, { name, route, ready, extra, reopen = false }) {
  for (const [i, width] of WIDTHS.entries()) {
    await page.setViewportSize({ width, height: 900 });
    if (i === 0 || reopen) {
      await page.goto(base + route);
      await ready(page);
    }
    await page.evaluate(() => document.fonts.ready);
    await wait(300);
    const problems = [...overflowProblems(await measureOverflow(page)), ...((await extra?.(page, width)) ?? [])];
    if (problems.length === 0) ok(`${width} px`);
    else {
      console.log(`   ✗ ${width} px`);
      for (const problem of problems) console.log(`     - ${problem}`);
      failures.push(...problems.map((problem) => `${name} a ${width} px: ${problem}`));
    }
    const file = screenName(name, width);
    if (shotsDir && file) {
      mkdirSync(shotsDir, { recursive: true });
      await page.screenshot({ path: join(shotsDir, file) });
    }
  }
}

const server = await serve();
const browser = await launch();
try {
  const user = { email: DEV_EMAIL, password: devPassword() };
  const apiUser = await apiSignIn(user);
  const { open, done } = await pickInspections(apiUser);
  const [client] = await serverDelta(apiUser, "clients");
  const [property] = await serverDelta(apiUser, "properties");
  const [template] = await serverDelta(apiUser, "templates");

  step(1, `${DEV_EMAIL} entra e baixa tudo`);
  const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: 900 } });
  const page = await context.newPage();
  await signIn(page, user, { next: "/inspections" });
  await page.getByText("Sincronizado", { exact: true }).first().waitFor({ timeout: 120_000 });
  ok("sincronizado");

  let n = 1;
  const listReady = (p) => p.locator("main tbody tr, main ul li a").filter({ visible: true }).first().waitFor({ timeout: 30_000 });
  for (const { route, columns } of LISTS) {
    step(++n, `${route}`);
    await check(page, {
      name: route.slice(1),
      route,
      ready: listReady,
      extra: async (p, width) => listProblems(await measureList(p), { width, columns }),
    });
  }

  step(++n, "a tela de campo, numa vistoria em andamento");
  await check(page, {
    name: "campo",
    route: `/inspections/edit?id=${open.id}`,
    ready: (p) => p.locator('main [role="radio"]').first().waitFor({ timeout: 30_000 }),
    extra: async (p) => fieldProblems(await measureField(p)),
  });

  step(++n, "o editor de roteiro");
  const label = (p, text) => p.getByLabel(text, { exact: true });
  await check(page, {
    name: "roteiro",
    route: `/templates/edit?id=${template.id}`,
    reopen: true,
    ready: (p) => p.getByRole("list", { name: "Ambientes" }).waitFor({ timeout: 30_000 }),
    extra: async (p, width) => {
      const twoPanels =
        (await label(p, "Nome do roteiro").isVisible()) && (await label(p, "Nome do ambiente").isVisible());
      return editorProblems({ twoPanels }, { width });
    },
  });

  const others = [
    ["nova-vistoria", "/inspections/new", "Começar vistoria"],
    ["laudo", `/inspections/report?id=${done.id}`, "Imprimir ou salvar PDF"],
    ["cliente", `/clients/edit?id=${client.id}`, "Salvar"],
    ["imovel", `/properties/edit?id=${property.id}`, "Salvar"],
  ];
  for (const [name, route, button] of others) {
    step(++n, `${route.split("?")[0]}`);
    await check(page, {
      name,
      route,
      ready: (p) => p.getByRole("button", { name: button }).first().waitFor({ timeout: 30_000 }),
    });
  }
  if (shotsDir) ok(`prints em ${shotsDir}`);

  assert.deepEqual(failures, [], `telas com problema:\n  ${failures.join("\n  ")}`);
  console.log("\nRoteiro concluído.");
} catch (error) {
  printTrace();
  throw error;
} finally {
  await browser.close();
  server.close();
}
