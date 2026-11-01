// As partes do `pnpm seed` que não dependem da API no ar: argumentos, o que falta criar, os corpos, o envio com retry e
// concorrência limitada, a senha do usuário de dev e o hook que carrega o client gerado (TypeScript) no Node.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generatePassword, readEnvValue, upsertEnvValue } from "../db-init/lib.mjs";

export const root = resolve(import.meta.dirname, "../..");

/** O usuário de desenvolvimento (vision.md, Comandos): nasce pelo `signUp`, nunca por migração. */
export const DEV_USER = { name: "Vistoriador de desenvolvimento", email: "dev@vistoria.local" };

/** Onde a senha dele mora: no ambiente (CI) ou no `infra/.env` (dev), nunca impressa nem em argumento (ADR 0025). */
export const PASSWORD_KEY = "DEV_USER_PASSWORD";

export const TEMPLATE_NAME = "Apartamento";

const USAGE = "Uso: pnpm seed [--inspections N] [--concurrency K]";
const OPTIONS = { "--inspections": ["inspections", 0], "--concurrency": ["concurrency", 1] };

/** `--inspections` (200 por padrão) e `--concurrency` (8). O `--` que o pnpm repassa é ignorado. */
export function parseArgs(argv) {
  const options = { inspections: 200, concurrency: 8 };
  const args = argv.filter((arg) => arg !== "--");
  for (let i = 0; i < args.length; i++) {
    const option = OPTIONS[args[i]];
    if (!option) throw new Error(`Opção desconhecida: ${args[i]}. ${USAGE}`);
    const [name, min] = option;
    const value = Number(args[i + 1]);
    if (args[i + 1] === undefined || !Number.isInteger(value) || value < min) {
      throw new Error(`${args[i]} precisa de um inteiro a partir de ${min}. ${USAGE}`);
    }
    options[name] = value;
    i++;
  }
  return options;
}

/** Clientes e imóveis crescem com as vistorias: um cliente a cada 20, um imóvel a cada 4. */
export const clientsFor = (inspections) => Math.max(1, Math.ceil(inspections / 20));
export const propertiesFor = (inspections) => Math.max(1, Math.ceil(inspections / 4));

/**
 * O que falta criar para o usuário ter `target` vistorias vivas (as que o app mostra). Rodar de novo completa até o
 * alvo, nunca soma: com o banco já no alvo (ou acima dele), não cria nada. `deleted` são as excluídas a mais.
 */
export function plan(target, existing) {
  const inspections = Math.max(0, target - existing.inspections);
  let deleted = 0;
  for (let index = existing.inspections; index < existing.inspections + inspections; index++) {
    if (alsoDeleted(index)) deleted++;
  }
  return {
    template: !existing.hasTemplate,
    clients: Math.max(0, clientsFor(target) - existing.clients),
    properties: Math.max(0, propertiesFor(target) - existing.properties),
    inspections,
    deleted,
  };
}

/** A vistoria viva de índice `index`, a cada 10: 4 concluídas e 6 em andamento. */
export const statusOf = (index) => (index % 10 < 4 ? "completed" : "inProgress");

/**
 * A cada 10 vistorias vivas, uma a mais que nasce em andamento e é excluída: o tombstone. Ele não conta no N, porque o
 * primeiro sync (sem cursor) devolve só os vivos e o app nunca o mostra (backend.md, Sync).
 */
export const alsoDeleted = (index) => index % 10 === 0;

/** Uma UUID v7, a única que a API aceita como `Idempotency-Key` (igual à de `scripts/outbox-spike/lib.mjs`). */
export function uuidv7() {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** O roteiro padrão "Apartamento" (vision.md, Template). */
export const TEMPLATE_ROOMS = [
  ["Sala", ["Piso", "Paredes", "Teto", "Janelas", "Porta de entrada", "Tomadas", "Iluminação"]],
  ["Cozinha", ["Piso", "Paredes", "Pia", "Torneira", "Armários", "Tomadas"]],
  ["Quarto 1", ["Piso", "Paredes", "Teto", "Janela", "Porta", "Tomadas", "Armário embutido"]],
  ["Quarto 2", ["Piso", "Paredes", "Teto", "Janela", "Porta", "Tomadas"]],
  ["Banheiro", ["Piso", "Azulejos", "Vaso sanitário", "Pia", "Chuveiro", "Box", "Espelho"]],
  ["Área de serviço", ["Piso", "Tanque", "Torneira", "Tomadas", "Varal"]],
];

export function templateBody() {
  return {
    name: TEMPLATE_NAME,
    rooms: TEMPLATE_ROOMS.map(([name, items], position) => ({
      id: uuidv7(),
      name,
      position,
      items: items.map((item, itemPosition) => ({ id: uuidv7(), name: item, position: itemPosition })),
    })),
  };
}

const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Fábio",
  "Gabriela",
  "Heitor",
  "Isabela",
  "João",
  "Larissa",
  "Marcos",
  "Natália",
  "Otávio",
  "Paula",
  "Rafael",
];
const LAST_NAMES = [
  "Almeida",
  "Barbosa",
  "Cardoso",
  "Duarte",
  "Esteves",
  "Ferreira",
  "Gomes",
  "Lima",
  "Moreira",
  "Nunes",
  "Oliveira",
  "Pereira",
  "Ribeiro",
  "Souza",
];

/** O cliente de índice `index`, sem documento (opcional, e com dígito verificador). */
export function clientBody(index) {
  const digits = String(index).padStart(8, "0").slice(-8);
  const lastName = Math.floor(index / FIRST_NAMES.length);
  return {
    name: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[lastName % LAST_NAMES.length]}`,
    document: null,
    email: `cliente${index + 1}@exemplo.com`,
    phone: `(11) 9${digits.slice(0, 4)}-${digits.slice(4)}`,
  };
}

const CITIES = [
  ["São Paulo", "SP"],
  ["Rio de Janeiro", "RJ"],
  ["Belo Horizonte", "MG"],
  ["Curitiba", "PR"],
  ["Porto Alegre", "RS"],
  ["Salvador", "BA"],
  ["Recife", "PE"],
  ["Fortaleza", "CE"],
];
const STREETS = [
  "Rua das Flores",
  "Avenida Brasil",
  "Rua Augusta",
  "Rua XV de Novembro",
  "Avenida Paulista",
  "Rua da Consolação",
  "Rua Sete de Setembro",
  "Avenida Atlântica",
];
const DISTRICTS = ["Centro", "Jardim América", "Vila Nova", "Bela Vista", "Boa Vista", "Santa Cecília"];
const PROPERTY_TYPES = ["apartment", "apartment", "house", "commercial", "other"];

/** O imóvel de índice `index`, do cliente `clientId`. */
export function propertyBody(index, clientId) {
  const [city, state] = CITIES[index % CITIES.length];
  const type = PROPERTY_TYPES[index % PROPERTY_TYPES.length];
  return {
    clientId,
    street: STREETS[Math.floor(index / CITIES.length) % STREETS.length],
    number: String(1 + ((index * 37) % 2000)),
    complement: type === "apartment" ? `Apto ${101 + (index % 12)}` : null,
    district: DISTRICTS[index % DISTRICTS.length],
    city,
    state,
    zipCode: String(10_000_000 + ((index * 7919) % 89_999_999)),
    type,
    notes: index % 7 === 0 ? "Chaves com o porteiro." : null,
  };
}

const CONDITIONS = ["new", "good", "fair", "poor", "absent"];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A vistoria de entrada de índice `index` no imóvel `propertyId`, com os ambientes e itens do roteiro (o `TemplateDto`
 * do servidor) e ids novos. A concluída tem todas as condições; a em andamento (e a que vai ser excluída), metade.
 */
export function inspectionBody(index, template, propertyId, { now = Date.now(), status = statusOf(index) } = {}) {
  const rooms = [...template.rooms].sort((a, b) => a.position - b.position);
  return {
    propertyId,
    kind: "moveIn",
    status,
    startedAt: new Date(now - ((index * 7) % 365) * DAY_MS).toISOString(),
    generalNotes: index % 3 === 0 ? "Vistoria feita com o inquilino presente." : null,
    rooms: rooms.map((room, position) => ({
      id: uuidv7(),
      name: room.name,
      position,
      notes: null,
      items: [...room.items]
        .sort((a, b) => a.position - b.position)
        .map((item, itemPosition) => {
          const evaluated = status === "completed" || (position + itemPosition) % 2 === 0;
          const seed = index + position + itemPosition;
          return {
            id: uuidv7(),
            name: item.name,
            position: itemPosition,
            condition: evaluated ? CONDITIONS[seed % CONDITIONS.length] : null,
            notes: evaluated && seed % 17 === 0 ? "Pequeno desgaste de uso." : null,
          };
        }),
    })),
  };
}

/**
 * Lê o delta desde `cursor` (do zero, sem ele) até o fim, página por página (`page(cursor)` devolve um `SyncPageDto`).
 * Devolve os vivos, os tombstones e o cursor do fim, para a próxima leitura trazer só o que mudou depois.
 */
export async function readDelta(page, cursor) {
  const items = [];
  const deletedIds = [];
  for (;;) {
    const body = await page(cursor);
    items.push(...body.items);
    deletedIds.push(...body.deletedIds);
    cursor = body.nextCursor;
    if (!body.hasMore) return { items, deletedIds, cursor };
  }
}

/** Quantos de `expected` não estão em `found` (um `Set` de ids). */
export const missingFrom = (found, expected) => expected.filter((id) => !found.has(id)).length;

/** O dado de uma chamada do SDK que deu certo, ou um erro com o status e o `type` do ProblemDetails. */
export function ok({ data, error, response }, what) {
  if (response?.ok) return data;
  const reason = response
    ? `${response.status}${error?.type ? ` (${error.type.replace(PROBLEM_PREFIX, "")})` : ""}`
    : `sem resposta (${error?.message ?? error})`;
  throw new Error(`${what} respondeu ${reason}`);
}

/**
 * Espera `ms` e devolve. Os testes trocam por um relógio falso.
 * @param {number} ms
 */
export const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const PROBLEM_PREFIX = "urn:vistoria:problem:";

/** O `type` do ProblemDetails de uma resposta, sem o prefixo da URN, ou `null`. */
export async function problemType(response) {
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  return typeof body?.type === "string" && body.type.startsWith(PROBLEM_PREFIX)
    ? body.type.slice(PROBLEM_PREFIX.length)
    : null;
}

/**
 * O access token do seed. `renew(stale)` entra de novo pelo `signIn`: várias chamadas que viram o mesmo token vencido
 * esperam uma renovação só, e quem chega depois de outra já ter renovado não pede outra.
 */
export function createSession(signIn) {
  let renewing = null;
  const session = {
    token: null,
    async renew(stale) {
      if (session.token !== stale) return;
      renewing ??= signIn()
        .then((token) => {
          session.token = token;
        })
        .finally(() => {
          renewing = null;
        });
      await renewing;
    },
  };
  return session;
}

const backoff = (attempt) => Math.min(30_000, 1000 * 2 ** (attempt - 1));

/**
 * O `fetch` do client gerado. Fora de `/auth/*` põe o token da sessão. Reenvia a mesma requisição (mesma
 * `Idempotency-Key`, mesmo corpo) quando a API pede: `rate-limited` (429) e `idempotency-in-progress` (409) depois do
 * `Retry-After`; `unauthorized` (o access token dura 15 min) depois de renovar; falha de rede e 5xx com espera
 * crescente. Desiste depois de `attempts` tentativas e devolve a última resposta.
 */
export function retryingFetch({ session, fetch = globalThis.fetch, sleep = wait, attempts = 10, onWait = () => {} }) {
  return async (request) => {
    // O corpo é lido uma vez e vai como texto em toda tentativa (um stream só pode ser lido uma vez).
    const body = request.body ? await request.text() : undefined;
    const authenticated = !new URL(request.url).pathname.startsWith("/api/v1/auth/");
    for (let attempt = 1; ; attempt++) {
      const token = authenticated ? session.token : null;
      const copy = new Request(request, body === undefined ? {} : { body });
      if (token) copy.headers.set("authorization", `Bearer ${token}`);
      let response;
      try {
        response = await fetch(copy);
      } catch (error) {
        if (attempt >= attempts) throw error;
        onWait("falha de rede", backoff(attempt));
        await sleep(backoff(attempt));
        continue;
      }
      if (response.ok || attempt >= attempts) return response;
      const type = await problemType(response);
      if (response.status === 429 || type === "rate-limited" || type === "idempotency-in-progress") {
        const ms = Math.max(1, Number(response.headers.get("retry-after")) || 1) * 1000;
        onWait(type ?? String(response.status), ms);
        await sleep(ms);
      } else if (authenticated && type === "unauthorized") {
        await session.renew(token);
      } else if (response.status >= 500) {
        onWait(String(response.status), backoff(attempt));
        await sleep(backoff(attempt));
      } else {
        return response;
      }
    }
  };
}

/** Roda `task(i)` para `i` de 0 a `count - 1` com no máximo `limit` em voo; o primeiro erro para de puxar novos. */
export async function pool(count, limit, task) {
  const results = new Array(count);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < count) {
      const index = next++;
      try {
        results[index] = await task(index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return results;
}

/**
 * A senha do usuário de dev: do ambiente (`DEV_USER_PASSWORD`, o caminho do CI), senão do `infra/.env`, senão gerada
 * e gravada nele (0600), sem mexer nas outras linhas. Nunca é impressa nem passa por argumento (ADR 0025).
 */
export function resolvePassword({ env = process.env, envPath = join(root, "infra", ".env") } = {}) {
  if (env[PASSWORD_KEY]) return { password: env[PASSWORD_KEY], source: "env" };
  const text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const stored = readEnvValue(text, PASSWORD_KEY);
  if (stored) return { password: stored, source: "file" };
  const password = generatePassword();
  writeFileSync(envPath, upsertEnvValue(text, PASSWORD_KEY, password), { mode: 0o600 });
  chmodSync(envPath, 0o600); // o mode do writeFileSync só vale para arquivo novo
  return { password, source: "generated" };
}

export const generatedDir = join(root, "apps", "web", "src", "shared", "api", "generated");

let hooked = false;

/**
 * Carrega o SDK e o `createClient` gerados pelo `pnpm gen:api`. O Node 24 tira os tipos sozinho; o hook só resolve os
 * imports relativos sem extensão do código gerado (`./client`, `./types.gen`) para o `.ts`, e só quando quem importa
 * é um `.ts`.
 */
export async function loadGeneratedClient() {
  if (!hooked) {
    registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL?.endsWith(".ts") && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
          const base = new URL(specifier, context.parentURL).href;
          const found = [`${base}.ts`, `${base}/index.ts`].find((url) => existsSync(fileURLToPath(url)));
          if (found) return next(found, context);
        }
        return next(specifier, context);
      },
    });
    hooked = true;
  }
  const [sdk, { createClient }] = await Promise.all([
    import(pathToFileURL(join(generatedDir, "sdk.gen.ts")).href),
    import(pathToFileURL(join(generatedDir, "client", "index.ts")).href),
  ]);
  return { sdk, createClient };
}
