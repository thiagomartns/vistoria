// `pnpm layout:tables`
// Roteiro da #208: as tabelas de /clients, /properties, /inspections e /templates não se sobrepõem do tablet ao
// desktop. O usuário de dev, com os dados do `pnpm seed`, entra e baixa tudo; cada lista é aberta a 768, 1024, 1279 e
// 1440 px e a tabela é medida no navegador. Quebra se uma célula visível tem o conteúdo mais largo que ela sem cortar
// (a sobreposição), se a primeira coluna fica com menos de 180 px, se a página rola na horizontal (a rolagem só vale
// dentro da borda) ou se, a 1440 px, falta uma coluna do Figma (ADR 0061).
// Com SCREENS=1, grava os prints em `.screens/tabelas/`, com os nomes do `pnpm screens --files` (tablet, notebook e
// desktop). Exige `pnpm db:up`, `pnpm dev:api`, `pnpm seed` e `pnpm --filter web build`.
// A senha do usuário de dev vem de DEV_USER_PASSWORD ou do infra/.env, nunca impressa (ADR 0025).

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { base, launch, ok, printTrace, serve, signIn, step } from "../outbox-spike/lib.mjs";
import { DEV_EMAIL, devPassword } from "../volume-spike/lib.mjs";
import { LISTS, WIDTHS, screenName, tableProblems } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const shotsDir = process.env.SCREENS ? resolve(process.env.INIT_CWD ?? root, ".screens/tabelas") : null;

/** Mede a tabela da lista aberta: os cabeçalhos, as células que transbordam sem corte e a rolagem da página. */
const measureTable = (page) =>
  page.evaluate(() => {
    const table = document.querySelector("main table");
    const shown = (cell) => getComputedStyle(cell).display !== "none";
    const titles = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const headers = [...table.querySelectorAll("thead th")].map((th, i) => ({
      text: titles[i],
      width: th.getBoundingClientRect().width,
      visible: shown(th),
    }));
    const spills = [];
    for (const row of table.querySelectorAll("tr")) {
      [...row.children].forEach((cell, i) => {
        if (!shown(cell) || getComputedStyle(cell).overflowX !== "visible") return;
        if (cell.scrollWidth > cell.clientWidth + 1) {
          spills.push({ text: cell.textContent.trim().slice(0, 40), column: titles[i] });
        }
      });
    }
    return { headers, spills, pageScrolls: document.documentElement.scrollWidth > window.innerWidth };
  });

const server = await serve();
const browser = await launch();
try {
  const user = { email: DEV_EMAIL, password: devPassword() };

  step(1, `${DEV_EMAIL} entra e baixa tudo`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, user, { next: "/clients" });
  await page.getByText("Sincronizado", { exact: true }).first().waitFor({ timeout: 120_000 });
  ok("sincronizado");

  const failures = [];
  let n = 1;
  for (const { route, columns } of LISTS) {
    step(++n, `${route} a ${WIDTHS.join(", ")} px`);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + route);
      await page.locator("main tbody tr").first().waitFor({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      const measure = await measureTable(page);
      const problems = tableProblems(measure, { width, columns });
      const shown = measure.headers.filter((header) => header.visible);
      const summary = shown.map((header) => `${header.text} ${Math.round(header.width)}`).join(" · ");
      if (problems.length === 0) ok(`${width} px: ${summary}`);
      else {
        console.log(`   ✗ ${width} px: ${summary}`);
        for (const problem of problems) console.log(`     - ${problem}`);
        failures.push(...problems.map((problem) => `${route} a ${width} px: ${problem}`));
      }
      const name = screenName(route, width);
      if (shotsDir && name) {
        mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({ path: join(shotsDir, name) });
      }
    }
  }
  if (shotsDir) ok(`prints em ${shotsDir}`);

  assert.deepEqual(failures, [], `tabelas com problema:\n  ${failures.join("\n  ")}`);
  console.log("\nRoteiro concluído.");
} catch (error) {
  printTrace();
  throw error;
} finally {
  await browser.close();
  server.close();
}
