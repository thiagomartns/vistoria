// Helpers dos roteiros do volume (`pnpm spike:volume`) e da migração do banco local (`pnpm spike:migration`): o
// usuário de dev do `pnpm seed`, as vistorias do servidor e a lista vista pela página.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readEnvValue } from "../db-init/lib.mjs";
import { base, callApi, root, until, wait } from "../outbox-spike/lib.mjs";

export const DEV_EMAIL = "dev@vistoria.local";
/** Os links de tela de campo da lista: um por vistoria na Table, montada também no celular (escondida), e outro na ListRow. */
export const ROW_LINK = 'a[href*="/inspections/edit?id="]';
/** Um por vistoria: o da linha da Table. */
export const TABLE_LINK = `tbody ${ROW_LINK}`;

export function devPassword() {
  if (process.env.DEV_USER_PASSWORD) return process.env.DEV_USER_PASSWORD;
  const envPath = join(root, "infra", ".env");
  const stored = existsSync(envPath) ? readEnvValue(readFileSync(envPath, "utf8"), "DEV_USER_PASSWORD") : "";
  if (!stored) throw new Error("sem DEV_USER_PASSWORD nem infra/.env com ela: rode `pnpm seed` antes.");
  return stored;
}

/** Entra pela API, esperando o Retry-After num 429 (o signin aceita 5 por minuto e IP). */
export async function apiSignIn(user) {
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
export async function serverInspections(user) {
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

/** O total de vistorias que o contador da lista diz ("10.000 vistorias", "50 de 10.000 vistorias"), ou null. */
export const listedTotal = (page) =>
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
export const markListReady = (context, rows) =>
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
export async function pageValue(page, name, what) {
  let value;
  await until(
    async () => (value = await page.evaluate((key) => window[key], name).catch(() => undefined)) !== undefined,
    what,
    120_000,
  );
  return value;
}

const NETWORK = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

/**
 * Liga e desliga a rede do aparelho. Com a CPU limitada, a página tem uma sessão CDP a mais, e nela o `setOffline` do
 * contexto corta as requisições, mas deixa o `navigator.onLine` verdadeiro (e o app acha que tem rede): a sessão CDP
 * também emula a rede, para o app ver o modo avião como num aparelho de verdade.
 */
export async function setOffline(context, cdp, offline) {
  await cdp?.send("Network.emulateNetworkConditions", { offline, ...NETWORK });
  await context.setOffline(offline);
}
