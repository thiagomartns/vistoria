// `pnpm seed [--inspections N] [--concurrency K]`: cria, só pela API e com o client gerado, o usuário de dev
// (dev@vistoria.local), clientes, imóveis, o roteiro "Apartamento" e N vistorias com ambientes e itens, parte delas
// concluídas e parte excluídas. Rodar de novo completa até N, sem duplicar nada. Exige `db:up` e `dev:api`.
//
// A senha do usuário de dev vem de DEV_USER_PASSWORD ou do infra/.env; sem nenhuma, é gerada e gravada lá (0600).
// Nunca é impressa nem passa por argumento (ADR 0025). Os roteiros do spike 2 (#134) entram com ela.

import {
  DEV_USER,
  TEMPLATE_NAME,
  alsoDeleted,
  clientBody,
  createSession,
  inspectionBody,
  loadGeneratedClient,
  ok,
  parseArgs,
  plan,
  pool,
  propertyBody,
  missingFrom,
  readDelta,
  resolvePassword,
  retryingFetch,
  templateBody,
  uuidv7,
} from "./lib.mjs";

const RECREATE_DB = "pnpm db:down && docker volume rm vistoria-dev_sqldata && pnpm db:up";
const PROGRESS_EVERY = 500;

function fail(message) {
  console.error(`seed: ${message}`);
  process.exit(1);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}

// Um erro da API (status e `type`) sai numa linha, sem o stack.
try {
  const baseUrl = process.env.API_URL ?? "http://localhost:8080";
  const { sdk, createClient } = await loadGeneratedClient();

  const health = await sdk.getHealth({ client: createClient({ baseUrl }) });
  if (!health.response?.ok) fail(`API fora do ar em ${baseUrl}: rode \`pnpm dev:api\`.`);

  const { password, source } = resolvePassword();
  if (source === "generated") console.log("seed: senha do usuário de dev gerada em infra/.env.");
  const credentials = { email: DEV_USER.email, password };

  let lastWaitLog = 0;
  const session = createSession(async () => ok(await sdk.signIn({ client, body: credentials }), "signin").accessToken);
  const client = createClient({
    baseUrl,
    fetch: retryingFetch({
      session,
      onWait: (reason, ms) => {
        // Com várias chamadas em voo, um 429 chega em rajada: uma linha a cada 5 s basta.
        if (Date.now() - lastWaitLog < 5000) return;
        lastWaitLog = Date.now();
        console.log(`   · ${reason}: espera ${Math.round(ms / 1000)} s e reenvia`);
      },
    }),
  });

  // Entrar: signUp na primeira vez, signIn depois (o e-mail já usado é 400 com errors.email).
  const signedUp = await sdk.signUp({ client, body: { ...DEV_USER, password } });
  if (signedUp.response?.ok) {
    session.token = signedUp.data.accessToken;
    console.log(`seed: ${DEV_USER.email} criado.`);
  } else {
    const emailTaken =
      signedUp.response?.status === 400 &&
      Object.keys(signedUp.error?.errors ?? {}).some((key) => /^email$/i.test(key));
    if (!emailTaken) ok(signedUp, "signup");
    if (source === "generated") {
      fail(
        `${DEV_USER.email} já existe, mas a senha dele não estava em infra/.env. Sem recuperação de senha, ` +
          `recrie o banco local: ${RECREATE_DB}`,
      );
    }
    const signedIn = await sdk.signIn({ client, body: credentials });
    if (signedIn.response?.status === 401) {
      fail(`a senha guardada não é a de ${DEV_USER.email}. Recrie o banco local: ${RECREATE_DB}`);
    }
    session.token = ok(signedIn, "signin").accessToken;
    console.log(`seed: ${DEV_USER.email} já existia; entrou.`);
  }

  const page = (sync, what) => async (cursor) => ok(await sync({ client, query: { cursor, limit: 1000 } }), what);

  // Lê o delta das quatro entidades desde os cursores de `since` (do zero, sem eles).
  async function snapshot(since = {}) {
    const read = async (name, sync, what) => [name, await readDelta(page(sync, what), since[name])];
    return Object.fromEntries([
      await read("clients", sdk.syncClients, "sync de clientes"),
      await read("properties", sdk.syncProperties, "sync de imóveis"),
      await read("templates", sdk.syncTemplates, "sync de roteiros"),
      await read("inspections", sdk.syncInspections, "sync de vistorias"),
    ]);
  }
  const cursors = (read) => Object.fromEntries(Object.entries(read).map(([name, { cursor }]) => [name, cursor]));
  const completedIn = (read) => read.inspections.items.filter((inspection) => inspection.status === "completed").length;

  const started = Date.now();
  const before = await snapshot();
  const existing = before.inspections.items.length;
  const todo = plan(options.inspections, {
    hasTemplate: before.templates.items.some((template) => template.name === TEMPLATE_NAME),
    clients: before.clients.items.length,
    properties: before.properties.items.length,
    inspections: existing,
  });
  console.log(
    `seed: já há ${existing} vistorias; cria ${todo.inspections} (e ${todo.deleted} excluídas), ` +
      `${todo.properties} imóveis e ${todo.clients} clientes` +
      (todo.template ? `, e o roteiro "${TEMPLATE_NAME}".` : "."),
  );

  const put = (upsert, what) => async (body) => {
    const id = uuidv7();
    const result = await upsert({ client, path: { id }, headers: { "Idempotency-Key": uuidv7() }, body });
    return { id, data: ok(result, what), etag: result.response.headers.get("etag") };
  };

  const template = todo.template
    ? (await put(sdk.upsertTemplate, "PUT do roteiro")(templateBody())).data
    : before.templates.items.find((existing) => existing.name === TEMPLATE_NAME);

  const clientIds = before.clients.items.map((existing) => existing.id);
  const newClients = await pool(todo.clients, options.concurrency, (k) =>
    put(sdk.upsertClient, "PUT do cliente")(clientBody(clientIds.length + k)),
  );
  clientIds.push(...newClients.map(({ id }) => id));

  const propertyIds = before.properties.items.map((existing) => existing.id);
  const firstProperty = propertyIds.length;
  const newProperties = await pool(todo.properties, options.concurrency, (k) => {
    const index = firstProperty + k;
    return put(sdk.upsertProperty, "PUT do imóvel")(propertyBody(index, clientIds[index % clientIds.length]));
  });
  propertyIds.push(...newProperties.map(({ id }) => id));

  const createdIds = [];
  const deletedIds = [];
  let sent = 0;
  await pool(todo.inspections, options.concurrency, async (k) => {
    const index = existing + k;
    const propertyId = propertyIds[index % propertyIds.length];
    createdIds.push(
      (await put(sdk.upsertInspection, "PUT da vistoria")(inspectionBody(index, template, propertyId))).id,
    );
    if (alsoDeleted(index)) {
      const body = inspectionBody(index, template, propertyId, { status: "inProgress" });
      const { id, etag } = await put(sdk.upsertInspection, "PUT da vistoria a excluir")(body);
      const result = await sdk.deleteInspection({
        client,
        path: { id },
        headers: { "Idempotency-Key": uuidv7(), "If-Match": etag },
      });
      ok(result, "DELETE da vistoria");
      deletedIds.push(id);
    }
    if (++sent % PROGRESS_EVERY === 0) console.log(`   · ${sent} de ${todo.inspections} vistorias`);
  });

  // Confere pelo delta desde a primeira leitura, que lê o SQL Server: tudo o que o seed criou está lá, uma vez só, e
  // cada vistoria excluída virou tombstone. O delta pode trazer outros tombstones: o cursor do primeiro sync para no
  // último vivo, então uma exclusão que fechou a rodada anterior volta aqui.
  const changed = await snapshot(cursors(before));
  const ids = (items) => new Set(items.map((item) => item.id));
  const missing = {
    clients: missingFrom(
      ids(changed.clients.items),
      newClients.map(({ id }) => id),
    ),
    properties: missingFrom(
      ids(changed.properties.items),
      newProperties.map(({ id }) => id),
    ),
    templates: todo.template ? missingFrom(ids(changed.templates.items), [template.id]) : 0,
    inspections: missingFrom(ids(changed.inspections.items), createdIds),
    deleted: missingFrom(new Set(changed.inspections.deletedIds), deletedIds),
  };
  const wrong = Object.keys(missing).filter((name) => missing[name] > 0);
  if (wrong.length > 0 || changed.inspections.items.length !== createdIds.length) {
    const detail = wrong.map((name) => `${missing[name]} ${name}`).join(", ");
    fail(
      `o delta não bate com o que foi criado: faltam ${detail || "0"}; ` +
        `${changed.inspections.items.length} vistorias novas, esperadas ${createdIds.length}.`,
    );
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `seed: ${existing + createdIds.length} vistorias de ${DEV_USER.email} ` +
      `(${completedIn(before) + completedIn(changed)} concluídas), ` +
      `${propertyIds.length} imóveis e ${clientIds.length} clientes; ` +
      `${deletedIds.length} excluídas nesta rodada; em ${seconds} s.`,
  );
} catch (error) {
  fail(error.message);
}
