// `pnpm spike:conflict`
// Roteiro do spike 3 (#110, ADR 0038): dois navegadores do mesmo usuário editam a mesma vistoria offline e convergem.
// Exige `pnpm db:up`, `pnpm dev:api` (http://localhost:8080) e `pnpm --filter web build`.
// O celular (A) cria e sincroniza; o desktop (B) abre pelo id (#101). Os dois editam offline, inclusive o mesmo item,
// e a rede volta: o que não colidiu converge sozinho, o que colidiu passa pelo ConflictResolver (#105), e o reenvio sai
// com chave nova. Depois, a exclusão (#109) e o mesmo cliente editado nos dois (#106).
// Antes do delta (M4), um aparelho só recebe o que o outro gravou no próprio envio seguinte, pelo 412: é assim que os
// dois terminam mostrando o mesmo. Com o pull ligado, os passos que dependem disso o seguram (`holdPull`, #144); a
// convergência pelo pull é do #135.
// O celular nunca recarrega (a sessão fica na memória) e sai do /login sem o service worker controlar a página; o
// desktop abre cada link pelo /login, sem service worker, para o modo avião barrar o fetch (spike 4 cobre o SW).
// Com SCREENS=1, tira os prints dos estados em `.screens/conflito/`, para `pnpm screens --files .screens/conflito`.

import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  askToDelete,
  checked,
  chipsOf,
  create,
  createInspection,
  createProperty,
  currentRoomIs,
  goTo,
  holdPull,
  inspectionRow,
  inspectionSettled,
  launch,
  linkOf,
  mark,
  ok,
  openRoom,
  outboxCount,
  printTrace,
  root,
  rowOf,
  serve,
  serverClient,
  serverInspection,
  settled,
  shooter,
  signIn,
  signUp,
  step,
  succeeded,
  until,
  versionOf,
  wait,
  watchDeletes,
  watchPuts,
} from "../outbox-spike/lib.mjs";

const shoot = shooter(process.env.SCREENS ? resolve(process.env.INIT_CWD ?? root, ".screens/conflito") : null);

/** O rótulo dos chips de cada condição do contrato (`CONDITIONS`, no web). */
const LABELS = { new: "Novo", good: "Bom", fair: "Regular", poor: "Ruim", absent: "Ausente" };

/** O que o servidor tem, por `Ambiente/Item`: a condição como o chip a mostra e a observação. */
const serverView = (inspection) =>
  Object.fromEntries(
    inspection.rooms.flatMap((room) =>
      room.items.map((item) => [`${room.name}/${item.name}`, [LABELS[item.condition] ?? null, item.notes ?? null]]),
    ),
  );

/** O que a tela de campo mostra, ambiente por ambiente, na forma do `serverView`. */
async function shownOn(page, inspection) {
  const shown = {};
  for (const room of inspection.rooms) {
    await openRoom(page, room.name);
    for (const item of room.items) {
      const radio = chipsOf(page, item.name).getByRole("radio", { checked: true });
      const note = page.getByRole("textbox", { name: `Observação: ${item.name}`, exact: true });
      shown[`${room.name}/${item.name}`] = [
        (await radio.count()) > 0 ? (await radio.textContent()).trim() : null,
        (await note.count()) > 0 ? (await note.inputValue()) || null : null,
      ];
    }
  }
  return shown;
}

/** O item `room/item` da vistoria do servidor. */
const itemOf = (inspection, room, item) =>
  inspection.rooms.find((r) => r.name === room).items.find((i) => i.name === item);

/**
 * Abre no desktop a tela de campo da vistoria `id` (a leitura por id): a primeira vez entra pelo `next` do /login; já
 * com a sessão, abre o endereço, e o reload renova a sessão pelo cookie (#132).
 */
async function openById(page, user, id, address) {
  if (new URL(page.url()).protocol === "about:") {
    await signIn(page, user, { next: `/inspections/edit?id=${id}` });
  } else {
    await page.goto(new URL(`/inspections/edit?id=${id}`, page.url()).href);
  }
  await page.getByRole("heading", { level: 1, name: address }).waitFor();
  await currentRoomIs(page, "Sala");
}

/** Volta da tela de campo para a lista de vistorias. */
async function backToList(page) {
  await page.getByRole("link", { name: "Voltar", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
}

/** Modo avião sem cortar o prefetch do Next no meio: a navegação offline depende dele. */
async function goOffline(context, page) {
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.getByText("Você está offline").first().waitFor();
}

const server = await serve();
const browser = await launch();
try {
  const user = await signUp("Caio dos dois aparelhos");
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const a = await phone.newPage();
  const b = await desk.newPage();
  const aPuts = watchPuts(a);
  const bPuts = watchPuts(b);
  const aDeletes = watchDeletes(a);
  const bDeletes = watchDeletes(b);
  const clientName = "Imobiliária Dois Aparelhos";
  const street = "Rua dos Dois";
  const address = `${street}, 10`;
  const option = `${address} · ${clientName}`;

  step(1, "A (celular) cria e sincroniza; B (desktop) abre a vistoria pelo id");
  await signIn(a, user);
  const client = await create(a, clientName);
  await createProperty(a, clientName, street, { pending: false });
  const vistoria = await createInspection(a, option);
  await mark(a, "Piso", "Bom");
  await mark(a, "Paredes", "Bom");
  await inspectionSettled(a, user, "a vistoria do celular sincroniza");
  const first = (await serverInspection(user, vistoria)).body;
  ok(`cliente, imóvel e vistoria criados no celular e no servidor (version ${first.version})`);
  const bGets = [];
  b.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (res.request().method() === "GET" && /^\/api\/v1\/(clients|properties|inspections)\//.test(path)) {
      bGets.push(`${path.split("/")[3]} ${res.status()}`);
    }
  });
  // Sem o delta, o desktop só tem o que abre pelo id: são os três GET.
  const releaseDeskDelta = await holdPull(desk, { byId: false });
  await openById(b, user, vistoria, address);
  assert.deepEqual(bGets, ["inspections 200", "properties 200", "clients 200"]);
  assert.ok(await checked(b, "Piso", "Bom"));
  assert.ok(await checked(b, "Paredes", "Bom"));
  assert.equal(await outboxCount(b, user), 0, "abrir pelo id não põe nada na fila");
  ok("o desktop abre pelo id: três GET, os mesmos chips do celular, nada na fila");
  await releaseDeskDelta();

  step(2, "Os dois offline editam a mesma vistoria, inclusive o mesmo item");
  await goOffline(phone, a);
  await goOffline(desk, b);
  // A: o Piso da Sala (o mesmo campo que B), a condição das Paredes (o mesmo item que B, outro campo) e o Teto da Cozinha.
  await mark(a, "Piso", "Ruim");
  await mark(a, "Paredes", "Regular");
  await openRoom(a, "Cozinha");
  await mark(a, "Teto", "Bom");
  // B: o Piso da Sala, a observação das Paredes e o Piso do Banheiro.
  await mark(b, "Piso", "Ausente");
  await b.getByRole("button", { name: "Adicionar observação: Paredes" }).click();
  await b.getByLabel("Observação: Paredes").fill("Fissura acima da janela.");
  await openRoom(b, "Banheiro");
  await mark(b, "Piso", "Bom");
  await wait(1800);
  assert.ok((await outboxCount(a, user)) >= 1, "a edição do celular fica na fila");
  assert.ok((await outboxCount(b, user)) >= 1, "a do desktop também");
  await a.getByText("Não enviado").first().waitFor();
  await b.getByText("Não enviado").first().waitFor();
  assert.equal((await serverInspection(user, vistoria)).body.version, first.version, "o servidor não recebeu nada");
  ok("as duas edições ficam \"Não enviado\", cada uma na fila do seu aparelho; o servidor segue na version do passo 1");
  await shoot(a, "dois-1-celular-offline");
  await shoot(b, "dois-1-desktop-offline");

  step(3, "A rede volta: o celular chega primeiro; o desktop recebe 412, converge o que não colidiu e resolve o Piso");
  // Até o passo 5, cada um só recebe o que o outro gravou no próprio envio, pelo 412.
  const releasePhonePull = await holdPull(phone);
  const releaseDeskPull = await holdPull(desk);
  const fromA = aPuts.length;
  await phone.setOffline(false);
  await settled(a, user, aPuts, fromA, 200, "a edição do celular é aceita");
  const afterA = (await serverInspection(user, vistoria)).body;
  ok(`celular: PUT com If-Match "${first.version}" → 200, version ${afterA.version}`);
  const fromB = bPuts.length;
  await desk.setOffline(false);
  await settled(b, user, bPuts, fromB, 412, "o 412 tira a edição do desktop da fila");
  await b.getByText("Esta vistoria foi alterada em outro aparelho").waitFor();
  await openRoom(b, "Sala");
  assert.equal(await b.getByText("Em conflito").count(), 1, "só o Piso da Sala fica \"Em conflito\"");
  // Com colisão, nada é adotado até a pessoa decidir (frontend.md, "Conflito"): a tela segue com o que está aqui.
  assert.ok(await checked(b, "Paredes", "Bom"), "a tela ainda não tem a condição das Paredes do celular");
  // A edição do desktop pode ter virado duas transações: a primeira, tentada offline, não é compactada. Com colisão,
  // nada é reenviado, e a de trás sai com o mesmo If-Match e leva o próprio 412: um por chave, e a fila para.
  await wait(3000);
  const conflictPuts = bPuts.slice(fromB);
  const refusedKeys = [...new Set(conflictPuts.filter((put) => put.status === 412).map((put) => put.key))];
  assert.ok(conflictPuts.every((put) => put.status === 412 || put.status === "falhou" || put.status === "sem resposta"));
  assert.equal(conflictPuts.filter((put) => put.status === 412).length, refusedKeys.length, "um 412 por transação, sem laço");
  assert.ok(conflictPuts.every((put) => put.ifMatch === `"${first.version}"`));
  assert.equal(await outboxCount(b, user), 0, "o conflito não volta sozinho para a fila");
  ok(`desktop: ${refusedKeys.length} transação(ões) com a version de antes → um 412 cada; só o Piso da Sala fica \"Em conflito\", e a tela segue com o daqui`);
  await shoot(b, "dois-2-conflito");

  await b.getByRole("link", { name: "Resolver conflito" }).click();
  await b.getByRole("heading", { level: 2, name: "Resolver conflito" }).waitFor();
  assert.equal(await b.getByRole("radiogroup").count(), 1, "o resolver mostra só o que colidiu");
  await b.getByRole("radiogroup", { name: "Piso · Condição" }).getByText("Ruim").click();
  await shoot(b, "dois-3-resolver");
  const fromResolution = bPuts.length;
  await b.getByRole("button", { name: "Enviar resolução" }).click();
  await currentRoomIs(b, "Sala");
  await settled(b, user, bPuts, fromResolution, 200, "a resolução sincroniza");
  const resolution = bPuts.slice(fromResolution);
  assert.equal(resolution.length, 1);
  assert.equal(resolution[0].ifMatch, `"${afterA.version}"`, "a resolução leva a version do current");
  assert.ok(!refusedKeys.includes(resolution[0].key), "a resolução sai com chave nova");
  assert.ok(await checked(b, "Piso", "Ruim"));
  assert.ok(await checked(b, "Paredes", "Regular"), "a condição das Paredes, do celular, entra sozinha");
  assert.equal(await b.getByLabel("Observação: Paredes").inputValue(), "Fissura acima da janela.");
  ok(`"Ruim", o do celular → PUT com If-Match "${afterA.version}" e chave nova → 200; a tela recarrega com o merge (Paredes Regular, com a observação daqui)`);

  step(4, "O SQL Server termina com as edições dos dois");
  const merged = (await serverInspection(user, vistoria)).body;
  assert.equal(merged.version, versionOf(resolution[0].etag), "nada foi aplicado depois da resolução");
  assert.equal(itemOf(merged, "Sala", "Piso").condition, "poor");
  assert.equal(itemOf(merged, "Sala", "Paredes").condition, "fair");
  assert.equal(itemOf(merged, "Sala", "Paredes").notes, "Fissura acima da janela.");
  assert.equal(itemOf(merged, "Cozinha", "Teto").condition, "good");
  assert.equal(itemOf(merged, "Banheiro", "Piso").condition, "good");
  ok(`version ${merged.version}: Piso escolhido, Paredes com a condição do celular e a observação do desktop, Teto da Cozinha do celular, Piso do Banheiro do desktop`);

  step(5, "Os dois mostram o mesmo: cada um recebe o que o outro gravou no próprio envio seguinte");
  // O celular ainda está na version da edição dele: o próximo envio dá 412, sem colisão, e o reenvio traz tudo.
  const fromAgain = aPuts.length;
  await openRoom(a, "Quarto");
  await mark(a, "Piso", "Bom");
  await settled(a, user, aPuts, fromAgain, 200, "o envio seguinte do celular converge");
  const again = aPuts.slice(fromAgain);
  assert.deepEqual(again.map((put) => put.status), [412, 200], "um 412 e um reenvio");
  assert.equal(again[1].ifMatch, `"${merged.version}"`);
  assert.notEqual(again[1].key, again[0].key, "o reenvio sai com chave nova");
  assert.equal(await a.getByText("Esta vistoria foi alterada em outro aparelho").count(), 0, "sem colisão, sem aviso");
  ok(`celular: Quarto/Piso → 412 → merge sem colisão → reenvio com If-Match "${merged.version}" e chave nova → 200`);
  // O desktop marca o mesmo: o merge dá igual ao servidor, e nada sai de novo; ele só adota o current.
  const fromSame = bPuts.length;
  await openRoom(b, "Quarto");
  await mark(b, "Piso", "Bom");
  await settled(b, user, bPuts, fromSame, 412, "o envio do desktop adota o current");
  await wait(3000);
  assert.equal(bPuts.length - fromSame, 1, "merge igual ao servidor não sai");
  const final = (await serverInspection(user, vistoria)).body;
  assert.equal(final.version, versionOf(again[1].etag));
  ok("desktop: o mesmo Quarto/Piso → 412 → merge igual ao servidor: adota o current, sem reenvio");
  await releasePhonePull();
  await releaseDeskPull();
  const expected = serverView(final);
  assert.deepEqual(await shownOn(a, final), expected, "o celular mostra o que o servidor tem");
  assert.deepEqual(await shownOn(b, final), expected, "o desktop também");
  await openRoom(a, "Sala");
  await shoot(a, "dois-4-convergiu");
  assert.equal(await outboxCount(a, user), 0);
  assert.equal(await outboxCount(b, user), 0);
  for (const page of [a, b]) await backToList(page);
  for (const page of [a, b]) {
    assert.equal(await rowOf(page, address).getByText("Conflito").count(), 0);
    assert.equal(await rowOf(page, address).getByText("Salvo no aparelho").count(), 0);
  }
  ok(`os dois mostram, ambiente por ambiente, o que o servidor tem na version ${final.version}; filas vazias, nenhum "Conflito"`);

  step(6, "Exclusão: excluída no desktop com edição no celular (recriar) e alterada no celular antes da exclusão no desktop");
  const ids = (inspection) => [
    inspection.id,
    ...inspection.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]),
  ];
  // Excluída em outro aparelho: o celular edita offline, o desktop exclui, e o PUT do celular volta 410.
  const gone = await createInspection(a, option);
  await mark(a, "Piso", "Bom");
  await inspectionSettled(a, user, "a vistoria a excluir sincroniza");
  await openById(b, user, gone, address);
  await goOffline(phone, a);
  await mark(a, "Paredes", "Ruim");
  await wait(1800);
  const fromBDelete = bDeletes.length;
  await (await askToDelete(b, b.getByRole("banner"))).getByRole("button", { name: "Excluir vistoria" }).click();
  await b.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  await until(async () => bDeletes.slice(fromBDelete).some((d) => d.status === 204), "o DELETE do desktop");
  ok("desktop: exclui a vistoria que o celular está editando offline → 204");
  const fromGone = aPuts.length;
  await phone.setOffline(false);
  await settled(a, user, aPuts, fromGone, 410, "o 410 tira a edição do celular da fila");
  await a.getByText("Esta vistoria foi excluída em outro aparelho").waitFor();
  ok("celular: a rede volta, o PUT → 410, e a tela de campo avisa");
  await a.getByRole("link", { name: "Resolver conflito" }).click();
  await a.getByRole("heading", { name: "Vistoria excluída em outro aparelho" }).waitFor();
  await shoot(a, "dois-5-excluida-em-outro-aparelho");
  const fromRecreate = aPuts.length;
  await a.getByRole("button", { name: "Recriar vistoria" }).click();
  await a.waitForURL((url) => url.pathname === "/inspections/edit" && url.searchParams.get("id") !== gone);
  const recreated = new URL(a.url()).searchParams.get("id");
  await currentRoomIs(a, "Sala");
  await settled(a, user, aPuts, fromRecreate, 201, "a recriada sincroniza");
  const recreatedBody = (await serverInspection(user, recreated)).body;
  assert.equal(itemOf(recreatedBody, "Sala", "Paredes").condition, "poor", "com a edição do celular");
  assert.equal(itemOf(recreatedBody, "Sala", "Piso").condition, "good");
  const goneBody = { ...JSON.parse(aPuts[fromGone].body), id: gone };
  assert.ok(!ids(recreatedBody).some((id) => ids(goneBody).includes(id)), "ids novos na raiz, nos ambientes e nos itens");
  assert.equal((await serverInspection(user, gone)).status, 404);
  ok(`recriar: 201 com id novo (${recreated}), a edição do celular e ids novos; a excluída segue 404`);
  await backToList(a);

  // Exclusão alterada: o celular muda a vistoria online, e o desktop, ainda com a versão de antes, exclui.
  const changed = await createInspection(a, option);
  await mark(a, "Piso", "Bom");
  await inspectionSettled(a, user, "a vistoria alterada sincroniza");
  await openById(b, user, changed, address);
  // O desktop exclui com a versão de antes: sem o pull, ele não vê a mudança do celular até o 412.
  const releaseRemovalPull = await holdPull(desk);
  const fromChange = aPuts.length;
  await mark(a, "Piso", "Ausente");
  await settled(a, user, aPuts, fromChange, 200, "a mudança do celular é aceita");
  const changedVersion = versionOf(aPuts.slice(fromChange).find(succeeded).etag);
  const fromRemoval = bDeletes.length;
  await (await askToDelete(b, b.getByRole("banner"))).getByRole("button", { name: "Excluir vistoria" }).click();
  await b.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  const changedRow = inspectionRow(b, changed);
  await changedRow.getByText("Conflito").waitFor();
  assert.equal(bDeletes.slice(fromRemoval)[0].status, 412);
  await releaseRemovalPull();
  ok("desktop: DELETE com a versão de antes da mudança do celular → 412, e a linha volta com \"Conflito\"");
  await changedRow.getByRole("link").click();
  const removal = b.getByRole("dialog", { name: "Excluir mesmo assim?" });
  await removal.waitFor();
  const behind = b
    .getByRole("radiogroup", { name: "Condição: Piso", includeHidden: true })
    .getByRole("radio", { name: "Ausente", includeHidden: true });
  // O formulário recebe os valores no efeito depois do primeiro render com o Dialog: espera o chip, não só o Dialog.
  await until(
    async () => (await behind.getAttribute("aria-checked")) === "true",
    "atrás do Dialog, o que o celular gravou",
    5000,
  );
  await shoot(b, "dois-6-exclusao-alterada");
  await removal.getByRole("button", { name: "Excluir vistoria" }).click();
  await b.getByRole("heading", { level: 1, name: "Vistorias" }).waitFor();
  await until(async () => (await changedRow.count()) === 0 && (await outboxCount(b, user)) === 0, "a exclusão confirmada sai", 90_000);
  const [refusedDelete, confirmedDelete] = bDeletes.slice(fromRemoval);
  assert.equal(confirmedDelete.status, 204);
  assert.equal(confirmedDelete.ifMatch, `"${changedVersion}"`);
  assert.notEqual(confirmedDelete.key, refusedDelete.key, "o DELETE confirmado sai com chave nova");
  assert.equal((await serverInspection(user, changed)).status, 404);
  ok(`"Excluir mesmo assim" no desktop, com a mudança do celular atrás: DELETE com If-Match "${changedVersion}" e chave nova → 204; GET 404`);
  assert.equal(aDeletes.length, 0, "o celular não excluiu nada");

  step(7, "Cadastro: o mesmo cliente editado nos dois, offline");
  await backToList(a);
  await goTo(a, "Clientes");
  await goTo(b, "Clientes");
  for (const page of [a, b]) {
    await linkOf(page, clientName).click();
    await page.getByRole("heading", { level: 1, name: clientName }).waitFor();
  }
  await goOffline(phone, a);
  await goOffline(desk, b);
  await a.getByLabel("Telefone").fill("(71) 3000-0001");
  await a.getByLabel("E-mail").fill("celular@doisaparelhos.com");
  await a.getByRole("button", { name: "Salvar" }).click();
  await a.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  await b.getByLabel("Telefone").fill("(71) 3000-0002");
  await b.getByLabel("Nome").fill("Dois Aparelhos Imóveis");
  await b.getByRole("button", { name: "Salvar" }).click();
  await b.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
  ok("celular muda Telefone e E-mail; desktop muda Telefone e Nome");
  const fromBClient = bPuts.length;
  await desk.setOffline(false);
  await settled(b, user, bPuts, fromBClient, 200, "o desktop chega primeiro");
  const bClientVersion = (await serverClient(user, client)).body.version;
  const fromAClient = aPuts.length;
  await phone.setOffline(false);
  await settled(a, user, aPuts, fromAClient, 412, "o 412 do celular");
  await rowOf(a, clientName).getByText("Conflito").waitFor();
  ok(`desktop → 200 (version ${bClientVersion}); celular → 412, e a linha fica com "Conflito"`);
  await linkOf(a, clientName).click();
  await a.getByText("Este cliente foi alterado em outro aparelho").waitFor();
  await a.getByRole("link", { name: "Resolver conflito" }).click();
  await a.getByRole("heading", { level: 2, name: "Resolver conflito" }).waitFor();
  assert.equal(await a.getByRole("radiogroup").count(), 1, "só o Telefone colide; E-mail e Nome entram sozinhos");
  await a.getByRole("radiogroup", { name: "Telefone" }).getByText("(71) 3000-0001").click();
  await shoot(a, "dois-7-cliente-resolver");
  const fromClientResolution = aPuts.length;
  await a.getByRole("button", { name: "Enviar resolução" }).click();
  await settled(a, user, aPuts, fromClientResolution, 200, "a resolução do cliente sincroniza");
  const clientResolution = aPuts.slice(fromClientResolution);
  assert.equal(clientResolution.length, 1);
  assert.equal(clientResolution[0].ifMatch, `"${bClientVersion}"`);
  assert.notEqual(clientResolution[0].key, aPuts[fromAClient].key, "a resolução sai com chave nova");
  const resolvedClient = (await serverClient(user, client)).body;
  assert.equal(resolvedClient.phone, "(71) 3000-0001", "o Telefone escolhido");
  assert.equal(resolvedClient.email, "celular@doisaparelhos.com", "o E-mail do celular");
  assert.equal(resolvedClient.name, "Dois Aparelhos Imóveis", "o Nome do desktop");
  ok(`"Neste aparelho" no celular → PUT com If-Match "${bClientVersion}" e chave nova → 200; servidor com Telefone e E-mail do celular e Nome do desktop`);

  console.log("\nRoteiro concluído.");
} catch (error) {
  printTrace();
  throw error;
} finally {
  await browser.close();
  server.close();
}
