import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  PASSWORD_KEY,
  TEMPLATE_NAME,
  alsoDeleted,
  clientBody,
  createSession,
  inspectionBody,
  loadGeneratedClient,
  missingFrom,
  ok,
  parseArgs,
  plan,
  pool,
  propertyBody,
  readDelta,
  resolvePassword,
  retryingFetch,
  statusOf,
  templateBody,
} from "./lib.mjs";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("argumentos", () => {
  it("200 vistorias e 8 em voo por padrão", () => {
    assert.deepEqual(parseArgs([]), { inspections: 200, concurrency: 8 });
  });

  it("aceita --inspections e --concurrency, e ignora o -- que o pnpm repassa", () => {
    assert.deepEqual(parseArgs(["--", "--inspections", "10000"]), { inspections: 10000, concurrency: 8 });
    assert.deepEqual(parseArgs(["--inspections", "0", "--concurrency", "2"]), { inspections: 0, concurrency: 2 });
  });

  it("recusa opção desconhecida e número inválido", () => {
    assert.throws(() => parseArgs(["--users", "3"]), /Opção desconhecida: --users/);
    assert.throws(() => parseArgs(["--inspections"]), /--inspections precisa de um inteiro/);
    assert.throws(() => parseArgs(["--inspections", "dez"]), /--inspections precisa de um inteiro/);
    assert.throws(() => parseArgs(["--inspections", "-1"]), /--inspections precisa de um inteiro/);
    assert.throws(() => parseArgs(["--concurrency", "0"]), /--concurrency precisa de um inteiro a partir de 1/);
  });
});

describe("o que falta criar", () => {
  const empty = { hasTemplate: false, clients: 0, properties: 0, inspections: 0 };

  it("com o banco vazio, cria tudo", () => {
    assert.deepEqual(plan(200, empty), { template: true, clients: 10, properties: 50, inspections: 200, deleted: 20 });
  });

  it("rodar de novo com o mesmo N não cria nada", () => {
    const seeded = { hasTemplate: true, clients: 10, properties: 50, inspections: 200 };
    assert.deepEqual(plan(200, seeded), { template: false, clients: 0, properties: 0, inspections: 0, deleted: 0 });
  });

  it("um N maior completa a diferença, sem recriar o roteiro", () => {
    const seeded = { hasTemplate: true, clients: 10, properties: 50, inspections: 200 };
    assert.deepEqual(plan(10000, seeded), {
      template: false,
      clients: 490,
      properties: 2450,
      inspections: 9800,
      deleted: 980,
    });
    // As excluídas seguem o índice global: completar 195 até 200 cai em 200 % 10 === 0 só se passar dele.
    assert.equal(plan(200, { ...seeded, inspections: 195 }).deleted, 0);
    assert.equal(plan(201, { ...seeded, inspections: 195 }).deleted, 1);
  });

  it("com mais do que N no banco, não cria nem apaga", () => {
    const seeded = { hasTemplate: true, clients: 500, properties: 2500, inspections: 10000 };
    assert.deepEqual(plan(200, seeded), { template: false, clients: 0, properties: 0, inspections: 0, deleted: 0 });
  });
});

describe("corpos", () => {
  // O roteiro como o servidor devolve (TemplateDto), fora de ordem de propósito.
  const sent = templateBody();
  const template = { ...sent, rooms: [...sent.rooms].reverse() };

  it("o roteiro é o Apartamento, dentro dos limites e com ids únicos", () => {
    assert.equal(sent.name, TEMPLATE_NAME);
    assert.ok(sent.rooms.length >= 1 && sent.rooms.length <= 40);
    const ids = sent.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => UUID_V7.test(id)));
    for (const room of sent.rooms) {
      assert.ok(room.items.length >= 1 && room.items.length <= 60);
      for (const name of [room.name, ...room.items.map((item) => item.name)]) {
        assert.ok(name.length >= 1 && name.length <= 60, name);
      }
    }
  });

  it("a cada 10 vistorias vivas, 4 concluídas, 6 em andamento e 1 excluída a mais", () => {
    const indexes = Array.from({ length: 200 }, (_, i) => i);
    assert.equal(indexes.filter((i) => statusOf(i) === "completed").length, 80);
    assert.equal(indexes.filter((i) => statusOf(i) === "inProgress").length, 120);
    assert.equal(indexes.filter(alsoDeleted).length, 20);
  });

  it("a vistoria segue o roteiro na ordem, com ids novos e únicos entre vistorias", () => {
    const bodies = Array.from({ length: 30 }, (_, i) => inspectionBody(i, template, "p"));
    assert.deepEqual(
      bodies[0].rooms.map((room) => room.name),
      sent.rooms.map((room) => room.name),
    );
    const templateIds = new Set(sent.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]));
    const ids = bodies.flatMap((body) => body.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => UUID_V7.test(id) && !templateIds.has(id)));
    assert.ok(bodies.every((body) => body.kind === "moveIn" && body.propertyId === "p"));
  });

  it("a concluída tem todas as condições; a em andamento, só parte", () => {
    const conditions = (body) => body.rooms.flatMap((room) => room.items.map((item) => item.condition));
    const completed = inspectionBody(1, template, "p");
    assert.equal(completed.status, "completed");
    assert.ok(conditions(completed).every((condition) => condition !== null));

    const inProgress = conditions(inspectionBody(5, template, "p"));
    assert.equal(inspectionBody(5, template, "p").status, "inProgress");
    assert.ok(inProgress.some((condition) => condition === null));
    assert.ok(inProgress.some((condition) => condition !== null));
    // A que vai ser excluída nasce em andamento (concluída, o DELETE seria 409 locked).
    assert.equal(inspectionBody(0, template, "p", { status: "inProgress" }).status, "inProgress");
  });

  it("startedAt no último ano, em ISO 8601", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    for (let i = 0; i < 400; i += 37) {
      const startedAt = Date.parse(inspectionBody(i, template, "p", { now }).startedAt);
      assert.ok(startedAt <= now && startedAt > now - 366 * 24 * 60 * 60 * 1000);
    }
  });

  it("cliente e imóvel passam nas regras do cadastro", () => {
    for (let i = 0; i < 300; i += 7) {
      const client = clientBody(i);
      assert.ok(client.name.length >= 2 && client.name.length <= 120);
      assert.ok(client.phone.length <= 20);
      const property = propertyBody(i, "c");
      assert.equal(property.clientId, "c");
      assert.match(property.zipCode, /^\d{8}$/);
      assert.match(property.state, /^[A-Z]{2}$/);
      assert.ok(["apartment", "house", "commercial", "other"].includes(property.type));
      assert.ok(property.street.length <= 120 && property.number.length <= 10);
      assert.ok((property.complement ?? "").length <= 60);
    }
  });
});

describe("delta", () => {
  const pages = {
    undefined: { items: [1, 2], deletedIds: [], nextCursor: "a", hasMore: true },
    a: { items: [3], deletedIds: [], nextCursor: "b", hasMore: false },
    b: { items: [4], deletedIds: ["y", "z"], nextCursor: "c", hasMore: false },
  };
  const reader = (cursors) => async (cursor) => {
    cursors.push(cursor);
    return pages[cursor];
  };

  it("do zero, lê todas as páginas e devolve o cursor do fim", async () => {
    const cursors = [];
    assert.deepEqual(await readDelta(reader(cursors)), { items: [1, 2, 3], deletedIds: [], cursor: "b" });
    assert.deepEqual(cursors, [undefined, "a"]);
  });

  it("desde um cursor, traz só o que mudou depois, com os tombstones", async () => {
    const cursors = [];
    assert.deepEqual(await readDelta(reader(cursors), "b"), { items: [4], deletedIds: ["y", "z"], cursor: "c" });
    assert.deepEqual(cursors, ["b"]);
  });

  it("aponta quantos ids criados faltam no delta", () => {
    assert.equal(missingFrom(new Set(["a", "b", "x"]), ["a", "b"]), 0);
    assert.equal(missingFrom(new Set(["a"]), ["a", "b", "c"]), 2);
  });
});

const problem = (status, type, headers = {}) =>
  new Response(JSON.stringify({ type: `urn:vistoria:problem:${type}`, status }), {
    status,
    headers: { "content-type": "application/problem+json", ...headers },
  });

const put = (token = null) =>
  new Request("http://api.test/api/v1/inspections/1", {
    method: "PUT",
    headers: { "idempotency-key": "k-1", ...(token ? { authorization: "Bearer velho" } : {}) },
    body: JSON.stringify({ rooms: [] }),
  });

/** Um `fetch` falso que responde `answers` em ordem e guarda o que recebeu. */
function fakeFetch(answers) {
  const seen = [];
  const fetch = async (request) => {
    seen.push({
      key: request.headers.get("idempotency-key"),
      auth: request.headers.get("authorization"),
      body: await request.text(),
    });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer;
  };
  return { fetch, seen };
}

describe("envio com retry", () => {
  const session = { token: "t1", renew: async () => assert.fail("não renova") };

  it("429: espera o Retry-After e reenvia a mesma chave e o mesmo corpo", async () => {
    const { fetch, seen } = fakeFetch([
      problem(429, "rate-limited", { "retry-after": "2" }),
      new Response(null, { status: 201 }),
    ]);
    const slept = [];
    const send = retryingFetch({ session, fetch, sleep: async (ms) => slept.push(ms) });
    const response = await send(put());
    assert.equal(response.status, 201);
    assert.deepEqual(slept, [2000]);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[1], seen[0]);
    assert.deepEqual(seen[0], { key: "k-1", auth: "Bearer t1", body: '{"rooms":[]}' });
  });

  it("409 idempotency-in-progress: espera o Retry-After e reenvia; outro 409 volta para quem chamou", async () => {
    const { fetch, seen } = fakeFetch([
      problem(409, "idempotency-in-progress", { "retry-after": "1" }),
      problem(409, "version-conflict"),
    ]);
    const slept = [];
    const response = await retryingFetch({ session, fetch, sleep: async (ms) => slept.push(ms) })(put());
    assert.equal(response.status, 409);
    assert.deepEqual(slept, [1000]);
    assert.equal(seen.length, 2);
  });

  it("falha de rede e 5xx: tenta de novo com espera crescente e desiste no limite", async () => {
    const { fetch } = fakeFetch([new TypeError("fetch failed"), problem(503, "internal"), problem(500, "internal")]);
    const slept = [];
    const response = await retryingFetch({ session, fetch, attempts: 3, sleep: async (ms) => slept.push(ms) })(put());
    assert.equal(response.status, 500);
    assert.deepEqual(slept, [1000, 2000]);
  });

  it("4xx do contrato (validation, locked) volta direto, sem reenviar", async () => {
    const { fetch, seen } = fakeFetch([problem(400, "validation")]);
    const response = await retryingFetch({ session, fetch, sleep: async () => assert.fail("não espera") })(put());
    assert.equal(response.status, 400);
    assert.equal(seen.length, 1);
  });

  it("401: renova uma vez só para várias chamadas e reenvia com o token novo", async () => {
    let signIns = 0;
    const renewing = createSession(async () => {
      signIns++;
      return "t2";
    });
    renewing.token = "t1";
    const fetch = async (request) =>
      request.headers.get("authorization") === "Bearer t2"
        ? new Response(null, { status: 200 })
        : problem(401, "unauthorized");
    const send = retryingFetch({ session: renewing, fetch, sleep: async () => {} });
    const responses = await Promise.all([send(put(true)), send(put(true)), send(put(true))]);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200, 200],
    );
    assert.equal(signIns, 1);
    assert.equal(renewing.token, "t2");
  });

  it("/auth/* vai sem o token da sessão", async () => {
    const { fetch, seen } = fakeFetch([new Response("{}", { status: 200 })]);
    await retryingFetch({ session, fetch })(
      new Request("http://api.test/api/v1/auth/signin", { method: "POST", body: "{}" }),
    );
    assert.equal(seen[0].auth, null);
  });

  it("ok() devolve o dado ou um erro com o status e o type", () => {
    assert.deepEqual(ok({ data: { a: 1 }, response: new Response(null, { status: 200 }) }, "x"), { a: 1 });
    assert.throws(
      () =>
        ok({ error: { type: "urn:vistoria:problem:locked" }, response: new Response(null, { status: 409 }) }, "PUT"),
      /PUT respondeu 409 \(locked\)/,
    );
    assert.throws(
      () => ok({ error: new TypeError("fetch failed") }, "GET"),
      /GET respondeu sem resposta \(fetch failed\)/,
    );
  });
});

describe("concorrência", () => {
  it("nunca passa do limite em voo e devolve todos os resultados na ordem", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await pool(25, 4, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((done) => setTimeout(done, 1 + (i % 3)));
      inFlight--;
      return i * 2;
    });
    assert.equal(peak, 4);
    assert.deepEqual(
      results,
      Array.from({ length: 25 }, (_, i) => i * 2),
    );
  });

  it("o primeiro erro para de puxar tarefas novas", async () => {
    const started = [];
    await assert.rejects(
      pool(50, 2, async (i) => {
        started.push(i);
        await new Promise((done) => setTimeout(done, 1));
        if (i === 3) throw new Error("falhou");
      }),
      /falhou/,
    );
    assert.ok(started.length < 10, `começou ${started.length}`);
  });
});

describe("senha do usuário de dev", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("o ambiente ganha do arquivo", () => {
    const envPath = join(dir, "env-ganha");
    writeFileSync(envPath, `${PASSWORD_KEY}=do-arquivo\n`);
    assert.deepEqual(resolvePassword({ env: { [PASSWORD_KEY]: "do-ambiente" }, envPath }), {
      password: "do-ambiente",
      source: "env",
    });
  });

  it("lê a guardada no infra/.env", () => {
    const envPath = join(dir, "guardada");
    writeFileSync(envPath, `MSSQL_SA_PASSWORD=sa\n${PASSWORD_KEY}=guardada\n`);
    assert.deepEqual(resolvePassword({ env: {}, envPath }), { password: "guardada", source: "file" });
  });

  it("sem nenhuma, gera, grava com 0600 e mantém as outras linhas", () => {
    const envPath = join(dir, "nova");
    writeFileSync(envPath, "# comentário\nMSSQL_SA_PASSWORD=sa\n", { mode: 0o644 });
    const { password, source } = resolvePassword({ env: {}, envPath });
    assert.equal(source, "generated");
    assert.ok(password.length >= 16);
    assert.equal(readFileSync(envPath, "utf8"), `# comentário\nMSSQL_SA_PASSWORD=sa\n${PASSWORD_KEY}=${password}\n`);
    assert.equal(statSync(envPath).mode & 0o777, 0o600);
    // Da segunda vez, é a mesma.
    assert.deepEqual(resolvePassword({ env: {}, envPath }), { password, source: "file" });
  });

  it("cria o arquivo se ele não existe", () => {
    const envPath = join(dir, "inexistente");
    const { password } = resolvePassword({ env: {}, envPath });
    assert.equal(readFileSync(envPath, "utf8"), `${PASSWORD_KEY}=${password}\n`);
    assert.equal(statSync(envPath).mode & 0o777, 0o600);
  });
});

describe("client gerado", () => {
  it("carrega o SDK do gen:api e monta o PUT da vistoria pelo contrato", async () => {
    const { sdk, createClient } = await loadGeneratedClient();
    const { fetch, seen } = fakeFetch([new Response('{"id":"v"}', { status: 201, headers: { etag: '"AAA="' } })]);
    const urls = [];
    const client = createClient({
      baseUrl: "http://api.test",
      fetch: retryingFetch({
        session: { token: "t1" },
        fetch: (request) => {
          urls.push(`${request.method} ${request.url}`);
          return fetch(request);
        },
      }),
    });
    const result = await sdk.upsertInspection({
      client,
      path: { id: "0190f0aa-0000-7000-8000-000000000000" },
      headers: { "Idempotency-Key": "k-9" },
      body: { propertyId: "p", kind: "moveIn", status: "inProgress", startedAt: "2026-11-01T00:00:00Z", rooms: [] },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.response.headers.get("etag"), '"AAA="');
    assert.deepEqual(urls, ["PUT http://api.test/api/v1/inspections/0190f0aa-0000-7000-8000-000000000000"]);
    assert.equal(seen[0].key, "k-9");
    assert.equal(seen[0].auth, "Bearer t1");
    assert.equal(JSON.parse(seen[0].body).kind, "moveIn");
  });
});
