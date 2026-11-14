// `pnpm spike:v1`
// A entrega do M5 (#178, vision.md, "Marcos"): a vistoria real de entrada e saída, ponta a ponta, com o laudo impresso,
// no docker-compose de produção. O fluxo que importa, lista → nova vistoria → ambiente por ambiente → concluir → laudo,
// com dois aparelhos do mesmo vistoriador: o notebook cadastra, revisa e emite os laudos; o celular faz o campo offline.
// Exige `pnpm prod:init` e `pnpm prod:up`. APP_URL troca a origem (padrão: https://localhost, com o certificado da CA
// interna do Caddy, que o navegador do roteiro aceita sem instalar).
// Os dois laudos em PDF vão para V1_OUT (padrão: .screens/v1/); com SCREENS=1, os prints do fluxo também, que o
// `pnpm screens --files .screens/v1` publica com os PDFs.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  base,
  chipsOf,
  checked,
  currentRoomIs,
  goTo,
  inspectionSettled,
  launch,
  markRoom,
  mark,
  ok,
  openRoom,
  outboxCount,
  printTrace,
  pullNow,
  root,
  signIn,
  step,
  until,
  useOrigin,
  wait,
} from "../outbox-spike/lib.mjs";

useOrigin(process.env.APP_URL ?? "https://localhost");
const outDir = resolve(process.env.INIT_CWD ?? root, process.env.V1_OUT ?? ".screens/v1");
mkdirSync(outDir, { recursive: true });

/** Um print do aparelho, com SCREENS=1: `v1-<nome>-celular.png` ou `v1-<nome>-desktop.png`, um por estado. */
async function shot(page, name) {
  if (!process.env.SCREENS) return;
  const device = page.viewportSize().width < 768 ? "celular" : "desktop";
  await page.evaluate(() => document.fonts.ready);
  await wait(400);
  await page.screenshot({ path: join(outDir, `v1-${name}-${device}.png`) });
  ok(`print v1-${name} (${device})`);
}

// Senha gerada na hora e nunca impressa (ADR 0025).
const user = {
  name: "Vistoriadora da V1",
  email: `v1-${Date.now()}-${randomBytes(3).toString("hex")}@exemplo.com`,
  password: randomBytes(18).toString("base64url"),
};
const clientName = `Imobiliária V1 ${randomBytes(2).toString("hex")}`;
const street = "Rua da Entrega";
const propertyOption = `${street}, 10 · ${clientName}`;
const TEMPLATE = [
  ["Sala", "Piso", "Paredes", "Janelas"],
  ["Cozinha", "Piso", "Pia", "Armários"],
  ["Banheiro", "Piso", "Box", "Vaso sanitário"],
];
const ROOMS = TEMPLATE.map(([room]) => room);
const templateOption = `Apartamento · ${TEMPLATE.length} ambientes, ${TEMPLATE.flat().length - TEMPLATE.length} itens`;
const notes = {
  phone: "Mancha de umidade no canto da janela.",
  notebook: "Rejunte escurecido atrás da torneira.",
  moveOut: "Furo de bucha na parede da TV.",
};

// O access token mais recente de qualquer aparelho (signup, signin ou refresh): as conferências no servidor passam pelo
// Caddy, com o `request` do contexto, que aceita o certificado da CA interna.
let token;
function watchToken(page) {
  page.on("response", async (res) => {
    if (!/\/api\/v1\/auth\/(signup|signin|refresh)$/.test(new URL(res.url()).pathname) || !res.ok()) return;
    token = (await res.json().catch(() => ({}))).accessToken ?? token;
  });
}
async function serverInspection(context, id) {
  const res = await context.request.get(`${base}/api/v1/inspections/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status(), 200, `GET da vistoria ${id} pelo Caddy`);
  return res.json();
}

/** O link da vistoria `id` na lista: a linha da Table no notebook, a ListRow no celular. */
const inspectionLink = (page, id) => page.locator(`a[href$="/inspections/edit?id=${id}"]`).locator("visible=true").first();

/** Da tela de campo de volta para a lista de vistorias. */
async function backToList(page) {
  await page.getByRole("link", { name: "Voltar", exact: true }).locator("visible=true").first().click();
  await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
}

/** Percorre os ambientes pelo Próximo da StepperForm, marcando "Bom" (menos o que `room` pedir) até o último. */
async function walkRooms(page, perRoom = async () => {}) {
  for (const [index, room] of ROOMS.entries()) {
    await currentRoomIs(page, room);
    await markRoom(page);
    await perRoom(room);
    if (index < ROOMS.length - 1) await page.getByRole("button", { name: "Próximo" }).click();
  }
}

/** Conclui pela StepperForm, no último ambiente, e confirma no Dialog. */
async function conclude(page) {
  await page.getByRole("button", { name: "Concluir vistoria" }).click();
  const dialog = page.getByRole("dialog", { name: "Concluir esta vistoria?" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Concluir vistoria" }).click();
  await page.getByText("Conclusão aguardando envio").waitFor();
}

/**
 * Abre o laudo pela tela da vistoria concluída e imprime: o botão chama o `window.print` (contado pelo stub do
 * notebook), na mídia de impressão o shell some e a folha fica, e o `page.pdf` sai com um ambiente por página.
 */
async function printReport(page, title, file) {
  await page.getByRole("link", { name: "Ver laudo" }).click();
  await page.waitForURL(/\/inspections\/report\?id=/);
  const sheet = page.getByRole("article", { name: title });
  await sheet.getByText(`Concluída por ${user.name} em`, { exact: false }).waitFor();
  assert.equal(await sheet.getByRole("region").count(), ROOMS.length, "um bloco por ambiente");
  const before = await page.evaluate(() => window.__prints);
  await page.getByRole("button", { name: "Imprimir ou salvar PDF" }).click();
  await until(async () => (await page.evaluate(() => window.__prints)) === before + 1, "o botão chama o window.print");
  await page.emulateMedia({ media: "print" });
  for (const [what, locator] of [
    ["a sidebar", page.getByRole("navigation").first()],
    ["o header", page.getByRole("banner")],
    ["o botão de imprimir", page.getByRole("button", { name: "Imprimir ou salvar PDF" })],
  ]) {
    assert.equal(await locator.isVisible(), false, `na impressão, ${what} some`);
  }
  assert.ok(await sheet.isVisible(), "na impressão, a folha fica");
  const pdf = await page.pdf({ format: "A4" });
  await page.emulateMedia({ media: null });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "o laudo vira PDF");
  const pages = pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
  assert.ok(pages >= ROOMS.length, `um ambiente por página (${pages} páginas)`);
  writeFileSync(join(outDir, file), pdf);
  return { sheet, pages };
}

// O `ignoreHTTPSErrors` do contexto não basta para o service worker: com o certificado da CA interna do Caddy, o
// Chrome recusa o registro ("An SSL certificate error occurred when fetching the script"), e sem ele o celular não abre
// offline. A flag do navegador aceita o certificado também ali; com um domínio de verdade em APP_URL, não muda nada.
const browser = await launch({ args: ["--ignore-certificate-errors"] });
const pages = {};
try {
  const notebookContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  // O "Imprimir ou salvar PDF" abre o diálogo do sistema: o stub só conta a chamada, e o PDF sai pelo `page.pdf`.
  await notebookContext.addInitScript(() => {
    window.__prints = 0;
    window.print = () => {
      window.__prints += 1;
    };
  });
  const notebook = await notebookContext.newPage();
  pages.notebook = notebook;
  watchToken(notebook);
  const phoneContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const phone = await phoneContext.newPage();
  pages.celular = phone;
  watchToken(phone);

  step(1, "Notebook: criar a conta e cadastrar o cliente, o imóvel e o roteiro \"Apartamento\"");
  await notebook.goto(`${base}/signup`);
  await notebook.getByLabel("Nome").fill(user.name);
  await notebook.getByLabel("E-mail").fill(user.email);
  await notebook.getByLabel("Senha").fill(user.password);
  const signUp = notebook.waitForResponse((res) => res.url() === `${base}/api/v1/auth/signup`);
  await notebook.getByRole("button", { name: "Criar conta" }).click();
  const signedUp = await signUp;
  assert.equal(signedUp.status(), 201, "o signup pelo Caddy");
  user.id = (await signedUp.json()).user.id;
  await notebook.waitForURL((url) => !url.pathname.startsWith("/signup"));

  await notebook.goto(`${base}/clients`);
  await notebook.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  await notebook.getByRole("link", { name: "Novo cliente" }).first().click();
  await notebook.getByRole("heading", { level: 1, name: "Novo cliente" }).waitFor();
  await notebook.getByLabel("Nome").fill(clientName);
  await notebook.getByRole("button", { name: "Salvar" }).click();
  await notebook.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();

  await goTo(notebook, "Imóveis");
  await notebook.getByRole("link", { name: "Novo imóvel" }).first().click();
  await notebook.getByRole("heading", { level: 1, name: "Novo imóvel" }).waitFor();
  await notebook.getByLabel("Cliente").click();
  await notebook.getByRole("option", { name: clientName }).click();
  await notebook.getByLabel("Tipo").click();
  await notebook.getByRole("option", { name: "Apartamento" }).click();
  await notebook.getByLabel("CEP").fill("40010-000");
  await notebook.getByLabel("Rua").fill(street);
  await notebook.getByLabel("Número").fill("10");
  await notebook.getByLabel("Bairro").fill("Comércio");
  await notebook.getByLabel("Cidade").fill("Salvador");
  await notebook.getByLabel("UF").fill("ba");
  await notebook.getByRole("button", { name: "Salvar" }).click();
  await notebook.getByRole("heading", { level: 1, name: "Imóveis" }).waitFor();

  await goTo(notebook, "Roteiros");
  await notebook.getByRole("link", { name: "Novo roteiro" }).first().click();
  await notebook.getByRole("heading", { level: 1, name: "Novo roteiro" }).waitFor();
  await notebook.getByLabel("Nome do roteiro").fill("Apartamento");
  for (const [index, [room, ...items]] of TEMPLATE.entries()) {
    if (index > 0) await notebook.getByRole("button", { name: "Adicionar ambiente" }).click();
    await notebook.getByLabel("Nome do ambiente").fill(room);
    for (const item of items) {
      await notebook.getByRole("button", { name: "Adicionar item" }).click();
      await notebook.getByRole("list", { name: "Itens" }).getByRole("textbox").last().fill(item);
    }
  }
  await shot(notebook, "1-roteiro");
  await notebook.getByRole("button", { name: "Salvar roteiro" }).click();
  await notebook.getByRole("heading", { level: 1, name: "Roteiros" }).waitFor();
  await until(async () => (await outboxCount(notebook, user)) === 0, "os cadastros chegam ao servidor", 60_000);
  ok(`conta, ${clientName}, ${street}, 10 e o roteiro "${templateOption}" no servidor, pelo Caddy`);

  step(2, "Celular: entrar num aparelho novo; o pull baixa o imóvel e o roteiro");
  await signIn(phone, user, { next: "/inspections" });
  await phone.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  const active = await phone.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((done) => setTimeout(() => done(false), 30_000)),
    ]),
  );
  assert.ok(active, "o service worker precisa estar ativo no celular, ou ele não abre offline");
  // Depois do reload, o service worker controla a página: offline, as telas abrem do pré-cache.
  await phone.reload();
  await phone.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  await phone.getByRole("link", { name: "Nova vistoria" }).first().click();
  await phone.getByRole("heading", { level: 1, name: "Nova vistoria" }).waitFor();
  await phone.getByLabel("Imóvel").click();
  await phone.getByRole("option", { name: propertyOption }).click();
  const templateSelect = phone.getByLabel("Roteiro", { exact: true });
  await until(async () => (await templateSelect.textContent()) === templateOption, "o roteiro do pull vem escolhido");
  ok(`o celular tem o imóvel e o "${templateOption}" pelo pull`);

  step(3, "Celular, offline (subsolo): criar a entrada do roteiro e percorrer os ambientes");
  await phoneContext.setOffline(true);
  await phone.getByText("Você está offline").waitFor();
  await shot(phone, "2-nova-entrada");
  await phone.getByRole("button", { name: "Começar vistoria" }).click();
  await phone.waitForURL(/\/inspections\/edit\?id=/);
  const entrada = new URL(phone.url()).searchParams.get("id");
  await walkRooms(phone, async (room) => {
    if (room !== "Sala") return;
    await mark(phone, "Janelas", "Regular");
    await phone.getByRole("button", { name: "Adicionar observação: Janelas" }).click();
    await phone.getByLabel("Observação: Janelas").fill(notes.phone);
    await shot(phone, "3-campo-entrada");
  });
  await wait(1800);
  await phone.reload();
  await currentRoomIs(phone, "Banheiro");
  await until(async () => checked(phone, "Vaso sanitário", "Bom"), "recarregada em modo avião, a marcação segue", 10_000);
  assert.ok((await outboxCount(phone, user)) > 0, "a entrada espera na fila do celular");
  ok("offline: a entrada nasce do roteiro, os três ambientes marcados, e volta ao recarregar em modo avião");

  await phoneContext.setOffline(false);
  await inspectionSettled(phone, user, "a entrada sai quando a rede volta");
  const sent = await serverInspection(phoneContext, entrada);
  assert.equal(sent.kind, "moveIn");
  assert.deepEqual(
    sent.rooms.map((room) => [room.name, ...room.items.map((item) => item.name)]),
    TEMPLATE,
    "a entrada chega com os ambientes e os itens do roteiro, na ordem",
  );
  await backToList(phone);
  ok("a rede volta: a entrada chega ao servidor com os ambientes e itens do roteiro");

  step(4, "Notebook: revisar a entrada; a observação daqui converge com o celular");
  await pullNow(notebookContext, notebook);
  await goTo(notebook, "Vistorias");
  await inspectionLink(notebook, entrada).click();
  await currentRoomIs(notebook, "Sala");
  assert.equal(await notebook.getByLabel("Observação: Janelas").inputValue(), notes.phone, "a observação do celular");
  await openRoom(notebook, "Cozinha");
  await notebook.getByRole("button", { name: "Adicionar observação: Pia" }).click();
  await notebook.getByLabel("Observação: Pia").fill(notes.notebook);
  await inspectionSettled(notebook, user, "a revisão do notebook sincroniza");
  await shot(notebook, "4-revisao");
  await backToList(notebook);

  await pullNow(phoneContext, phone);
  await inspectionLink(phone, entrada).click();
  await currentRoomIs(phone, "Banheiro");
  await phone.getByRole("button", { name: "Anterior" }).click();
  await currentRoomIs(phone, "Cozinha");
  await until(
    async () => (await phone.getByLabel("Observação: Pia").inputValue({ timeout: 500 }).catch(() => "")) === notes.notebook,
    "a observação do notebook chega ao celular",
  );
  assert.equal(await outboxCount(phone, user), 0, "convergir não deixa nada na fila");
  ok("o notebook vê a observação do celular e escreve a dele; o celular a recebe pelo pull, sem conflito");

  step(5, "Celular, offline: concluir a entrada; com a rede, a conclusão chega uma vez só");
  await phone.getByRole("button", { name: "Próximo" }).click();
  await currentRoomIs(phone, "Banheiro");
  await phoneContext.setOffline(true);
  await phone.getByText("Você está offline").waitFor();
  await conclude(phone);
  assert.ok(await chipsOf(phone, "Box").getByRole("radio", { name: "Novo" }).isDisabled(), "concluída, só leitura");
  await shot(phone, "5-conclusao-aguardando");
  await phoneContext.setOffline(false);
  await until(async () => (await outboxCount(phone, user)) === 0, "a conclusão sai quando a rede volta", 90_000);
  await phone.getByText(`Vistoria concluída por ${user.name} em`, { exact: false }).waitFor({ timeout: 30_000 });
  const completed = await serverInspection(phoneContext, entrada);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.completedBy, { id: user.id, name: user.name }, "o servidor gravou quem concluiu");
  await backToList(phone);
  ok("a conclusão fica \"aguardando envio\" offline e chega com o completedBy do servidor");

  step(6, "Notebook: o laudo da entrada, impresso e em PDF");
  await pullNow(notebookContext, notebook);
  await inspectionLink(notebook, entrada).click();
  await notebook.getByText(`Vistoria concluída por ${user.name} em`, { exact: false }).waitFor();
  const moveIn = await printReport(notebook, "Laudo de vistoria de entrada", "laudo-entrada.pdf");
  for (const text of [notes.phone, notes.notebook]) await moveIn.sheet.getByText(text).waitFor();
  await shot(notebook, "6-laudo-entrada");
  ok(`o laudo tem as observações dos dois aparelhos; impresso, ${moveIn.pages} páginas A4 em laudo-entrada.pdf`);
  await notebook.goBack();
  await backToList(notebook);

  step(7, "Celular, offline: a saída da entrada, com o estado anterior ao lado; concluir");
  await phone.getByRole("link", { name: "Nova vistoria" }).first().click();
  await phone.getByRole("heading", { level: 1, name: "Nova vistoria" }).waitFor();
  await phoneContext.setOffline(true);
  await phone.getByText("Você está offline").waitFor();
  await phone.getByLabel("Imóvel").click();
  await phone.getByRole("option", { name: propertyOption }).click();
  await phone.getByRole("radio", { name: "Saída" }).click();
  await phone.getByLabel("Vistoria de entrada").waitFor();
  await shot(phone, "7-nova-saida");
  await phone.getByRole("button", { name: "Começar vistoria" }).click();
  await phone.waitForURL(/\/inspections\/edit\?id=/);
  const saida = new URL(phone.url()).searchParams.get("id");
  await phone.getByText("Na entrada").first().waitFor();
  await walkRooms(phone, async (room) => {
    if (room !== "Sala") return;
    await mark(phone, "Paredes", "Ruim");
    await phone.getByRole("button", { name: "Adicionar observação: Paredes" }).click();
    await phone.getByLabel("Observação: Paredes").fill(notes.moveOut);
    await shot(phone, "8-campo-saida");
  });
  await wait(1800);
  await conclude(phone);
  await phoneContext.setOffline(false);
  await until(async () => (await outboxCount(phone, user)) === 0, "a saída e a conclusão saem com a rede", 90_000);
  const moveOut = await serverInspection(phoneContext, saida);
  assert.equal(moveOut.kind, "moveOut");
  assert.equal(moveOut.referenceInspectionId, entrada, "a saída aponta para a entrada");
  assert.equal(moveOut.status, "completed");
  const paredes = moveOut.rooms[0].items.find((item) => item.name === "Paredes");
  assert.deepEqual(
    [paredes.referenceCondition, paredes.condition, paredes.notes],
    ["good", "poor", notes.moveOut],
    "a Paredes da Sala: Bom na entrada, Ruim na saída",
  );
  ok("offline: a saída nasce da entrada com \"Na entrada\" ao lado, é concluída e chega com a referência");

  step(8, "Notebook: o laudo da saída, com a entrada ao lado, impresso e em PDF");
  await pullNow(notebookContext, notebook);
  await inspectionLink(notebook, saida).click();
  await notebook.getByText(`Vistoria concluída por ${user.name} em`, { exact: false }).waitFor();
  const exit = await printReport(notebook, "Laudo de vistoria de saída", "laudo-saida.pdf");
  await exit.sheet.getByRole("columnheader", { name: "Entrada" }).first().waitFor();
  const row = exit.sheet.getByRole("row").filter({ hasText: notes.moveOut });
  assert.deepEqual(
    (await row.getByRole("cell").allInnerTexts()).map((text) => text.trim()),
    ["Paredes", "Bom", "Ruim", notes.moveOut],
    "a linha da Paredes: Entrada Bom, Saída Ruim e a observação",
  );
  await shot(notebook, "9-laudo-saida");
  ok(`o laudo da saída mostra a entrada ao lado; impresso, ${exit.pages} páginas A4 em laudo-saida.pdf`);

  console.log(`\nV1 ponta a ponta no compose de produção (${base}). Laudos em ${outDir}.`);
} catch (error) {
  printTrace();
  // A tela de cada aparelho na hora da falha, para o log do CI dizer o que eles mostravam.
  for (const [device, page] of Object.entries(pages)) {
    await page.screenshot({ path: join(outDir, `falha-${device}.png`) }).catch(() => {});
  }
  console.log(`Telas da falha em ${outDir}/falha-*.png`);
  throw error;
} finally {
  await browser.close();
}
