import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";

import { expireSession } from "../auth/session";
import type { DraftRecord } from "./drafts";
import { hasPending } from "./fetch";
import type { CursorStore } from "./pull";
import { V, closeDevices, device, fakeApi, stopLater } from "./pull.harness";
import { startPull } from "./pull-triggers";

// O pull de ponta a ponta (frontend.md, "Leitura (pull)"; ADR 0041, 0042 e 0043), com o harness de `pull.harness.ts`:
// a outbox e a mutationFn de verdade, a camada otimista do TanStack DB e um servidor falso que pagina o delta.

vi.mock("../auth/session", () => ({
  canSendAs: () => true,
  sessionStore: { subscribe: () => () => {} },
  expireSession: vi.fn<() => void>(),
}));

const ID = "01a16032-2dfb-77de-84a2-1f165bdd9950";

/** O cliente como os dois aparelhos o confirmaram (V1). */
const clientV1: ClientRecord = {
  id: ID,
  version: V(1),
  name: "Imobiliária Alfa",
  document: null,
  email: "contato@alfa.com",
  phone: null,
};

const clientOf = (n: number): ClientRecord => ({
  ...clientV1,
  id: `01a16032-2dfb-77de-84a2-1f165bdd99${String(n).padStart(2, "0")}`,
  name: `Cliente ${n}`,
});

const propertyOf = (clientId: string): PropertyRecord => ({
  id: "01a16032-2dfb-77de-84a2-1f165bdd9a00",
  version: null,
  clientId,
  street: "Rua Direita",
  number: "10",
  complement: null,
  district: "Centro",
  city: "Salvador",
  state: "BA",
  zipCode: "40020000",
  type: "apartment",
  notes: null,
});

afterEach(() => {
  closeDevices();
  vi.mocked(expireSession).mockClear();
  vi.restoreAllMocks();
});

const draftOf = (status: DraftRecord["status"]): DraftRecord => ({
  id: ID,
  entity: "client",
  data: { ...clientV1, phone: "(71) 4444-0000" },
  status,
  errors: status === "rejected" ? { phone: ["Telefone inválido."] } : {},
  ...(status === "conflict" && { conflict: { current: clientV1, collisions: [] } }),
  updatedAt: "2026-10-29T10:00:00.000Z",
});

describe("pull: registro com pendência (ADR 0041)", () => {
  it("transação na fila (em voo): a store confirmada fica na V1 e o registro ganha a marca", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
    const phone = await device(api, { clients: [clientV1] });
    const release = api.hold("/api/v1/clients/");
    phone.saveClient({ ...clientV1,  phone: "(71) 4444-0000" });
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/clients/${ID}`));

    expect(await phone.pull()).toBe("done");

    expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
    expect(phone.marks.list("clients")).toEqual([ID]);
    release();
  });

  it("não perder: o Telefone daqui na fila e o Nome do outro aparelho no pull convergem pelo 412, sem colisão", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });
    const release = api.hold("/api/v1/clients/");
    phone.saveClient({ ...clientV1,  phone: "(71) 4444-0000" });
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/clients/${ID}`));
    // O outro aparelho muda o Nome enquanto o envio daqui está em voo.
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });

    await phone.pull();
    expect(phone.clients.confirmed.get(ID)?.version).toBe(V(1));

    release();
    await phone.drained();
    const merged = { ...clientV1, name: "Alfa Imóveis", phone: "(71) 4444-0000" };
    expect(api.current("clients", ID)).toEqual({ ...merged, version: V(3) });
    expect(phone.drafts.size).toBe(0);

    // A marca sai no ciclo seguinte, pelo GET: a store fica com o que os dois gravaram.
    await phone.pull();
    expect(phone.clients.confirmed.get(ID)).toEqual({ ...merged, version: V(3) });
    expect(phone.marks.list("clients")).toEqual([]);
  });

  it.each(["draft", "rejected", "conflict"] as const)(
    "rascunho %s: nem a store nem o rascunho mudam, e o registro ganha a marca",
    async (status) => {
      const api = fakeApi();
      api.seed("clients", clientV1);
      api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
      const phone = await device(api, { clients: [clientV1] });
      phone.drafts.insert(draftOf(status));

      await phone.pull();

      expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
      expect(phone.clients.acceptMutations).not.toHaveBeenCalled();
      expect(phone.drafts.get(ID)).toMatchObject(draftOf(status));
      expect(phone.drafts.get(ID)).not.toHaveProperty("rebasedAt");
      expect(phone.marks.list("clients")).toEqual([ID]);
    },
  );

  it("a pendência é a da hora de aplicar: uma escrita feita com a página em voo vence", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
    const phone = await device(api, { clients: [clientV1] });
    const releasePage = api.hold("/api/v1/sync/clients");
    api.hold("/api/v1/clients/"); // o envio fica em voo até o fim do teste

    const pulling = phone.pull();
    await vi.waitFor(() =>
      expect(api.requests.some((r) => r.startsWith("GET /api/v1/sync/clients"))).toBe(true),
    );
    phone.saveClient({ ...clientV1,  phone: "(71) 4444-0000" });
    releasePage();
    await pulling;

    expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
    expect(phone.marks.list("clients")).toEqual([ID]);
  });

  it("a pendência some sem envio (rascunho descartado): o ciclo seguinte busca a versão do servidor e tira a marca", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
    const phone = await device(api, { clients: [clientV1] });
    phone.drafts.insert(draftOf("rejected"));
    const triggers = startPull({ ownerId: "ana", run: phone.pull, drafts: phone.drafts });
    stopLater(triggers.dispose);
    await vi.waitFor(() => expect(phone.marks.list("clients")).toEqual([ID]));

    // Descartar o rascunho é um gatilho: nenhuma outra mudança no servidor é preciso.
    phone.drafts.delete(ID);

    await vi.waitFor(() => expect(phone.marks.list("clients")).toEqual([]));
    expect(phone.clients.confirmed.get(ID)).toEqual({
      ...clientV1,
      name: "Alfa Imóveis",
      version: V(2),
    });
    expect(api.requests).toContain(`GET /api/v1/clients/${ID}`);
  });

  it("eco da própria escrita: o item com a version da store não regrava o registro", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });

    expect(await phone.pull()).toBe("done");

    expect(phone.clients.acceptMutations).not.toHaveBeenCalled();
    expect(phone.marks.list("clients")).toEqual([]);
  });
});

describe("pull: o laço por entidade", () => {
  it("sem pendência: o registro recebe a versão do servidor, o excluído sai, e a ordem é cliente, imóvel e vistoria", async () => {
    const api = fakeApi();
    const removed = clientOf(1);
    api.seed("clients", clientV1);
    api.seed("clients", { ...removed, version: V(2) });
    api.write("clients", { ...clientV1, email: "vendas@alfa.com" });
    api.write("clients", removed, true);
    const property = propertyOf(ID);
    api.write("properties", property);
    const phone = await device(api, { clients: [clientV1, { ...removed, version: V(2) }] });
    // A partir do cursor de quem já tinha a V1 e a V2.
    await phone.state.cursors.set("clients", "2");

    expect(await phone.pull()).toBe("done");

    expect([...phone.clients.confirmed.values()]).toEqual([
      { ...clientV1, email: "vendas@alfa.com", version: V(3) },
    ]);
    expect([...phone.properties.confirmed.values()]).toEqual([{ ...property, version: V(5) }]);
    expect(phone.clients.collection.get(ID)?.email).toBe("vendas@alfa.com");
    expect(api.requests).toEqual([
      "GET /api/v1/sync/clients?cursor=2",
      "GET /api/v1/sync/properties",
      "GET /api/v1/sync/inspections",
    ]);
  });

  it("três páginas em ordem; derrubada a terceira, repetir retoma dela sem baixar as duas primeiras", async () => {
    const api = fakeApi({ pageSize: 2 });
    for (let n = 1; n <= 5; n += 1) api.write("clients", clientOf(n));
    const phone = await device(api);
    api.failNext("/api/v1/sync/clients?cursor=4", () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await phone.pull()).toBe("offline");
    expect(phone.state.cursors.get("clients")).toBe("4");
    expect(phone.clients.confirmed.size).toBe(4);

    api.requests.length = 0;
    expect(await phone.pull()).toBe("done");

    expect(api.requests).toEqual([
      "GET /api/v1/sync/clients?cursor=4",
      "GET /api/v1/sync/properties",
      "GET /api/v1/sync/inspections",
    ]);
    expect([...phone.clients.confirmed.keys()]).toEqual([1, 2, 3, 4, 5].map((n) => clientOf(n).id));
  });

  it("caiu entre a página e o cursor: a mesma página volta, e reaplicá-la não regrava nada", async () => {
    const api = fakeApi({ pageSize: 2 });
    for (let n = 1; n <= 3; n += 1) api.write("clients", clientOf(n));
    const saved = new Map<string, string>();
    let failures = 1;
    const cursors: CursorStore = {
      get: (entity) => saved.get(entity),
      set: async (entity, cursor) => {
        if (cursor === "3" && failures-- > 0) throw new Error("aba fechada");
        saved.set(entity, cursor);
      },
      complete: () => false,
      resyncing: () => false,
      resync: async () => {},
    };
    const phone = await device(api, { cursors });

    await expect(phone.pull()).rejects.toThrow("aba fechada");
    expect(phone.clients.confirmed.size).toBe(3);
    phone.clients.acceptMutations.mockClear();

    expect(await phone.pull()).toBe("done");

    expect(api.requests.filter((r) => r.includes("sync/clients"))).toEqual([
      "GET /api/v1/sync/clients",
      "GET /api/v1/sync/clients?cursor=2",
      "GET /api/v1/sync/clients?cursor=2",
    ]);
    expect(phone.clients.acceptMutations).not.toHaveBeenCalled();
    expect(saved.get("clients")).toBe("3");
  });

  it("unauthorized: expira a sessão e para o ciclo, sem puxar imóveis", async () => {
    const api = fakeApi();
    const phone = await device(api);
    api.failNext("/api/v1/sync/clients", () => api.problem("unauthorized", 401));

    expect(await phone.pull()).toBe("failed");

    expect(expireSession).toHaveBeenCalledOnce();
    expect(api.requests).toEqual(["GET /api/v1/sync/clients"]);
  });

  it("sem rede: nem pede, e o cursor fica", async () => {
    const api = fakeApi();
    const phone = await device(api);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    expect(await phone.pull()).toBe("offline");

    expect(api.requests).toEqual([]);
    expect(phone.state.cursors.get("clients")).toBeUndefined();
  });
});

// O cursor vencido ou ilegível pede o resync completo da entidade (ADR 0043): puxa do zero por cima do que o aparelho
// tem e só no fim tira o que não veio, menos o que tem pendência.
describe("pull: a store lida por chave (spike 2, ADR 0047)", () => {
  it("a página lê da store confirmada só os ids dela, e a store inteira só no resync", async () => {
    const api = fakeApi();
    const [kept, changed, removed] = [clientOf(1), clientOf(2), clientOf(3)];
    for (const row of [kept, changed, removed]) api.seed("clients", { ...row, version: V(1) });
    api.write("clients", { ...changed, name: "Cliente 2 renomeado" });
    api.write("clients", removed, true);
    api.write("clients", clientOf(4));
    const phone = await device(api, {
      clients: [kept, changed, removed].map((row) => ({ ...row, version: V(1) })),
    });
    await phone.state.cursors.set("clients", "1");

    expect(await phone.pull()).toBe("done");

    const asked = phone.clients.readConfirmed.mock.calls.map(([ids]) => [...ids].toSorted());
    expect(asked).toContainEqual([changed.id, removed.id, clientOf(4).id].toSorted());
    expect(asked.flat()).not.toContain(kept.id);
    expect(phone.clients.exportData).not.toHaveBeenCalled();
    expect(phone.clients.confirmed.get(changed.id)?.name).toBe("Cliente 2 renomeado");
    expect(phone.clients.confirmed.has(removed.id)).toBe(false);
    expect(phone.clients.confirmed.has(clientOf(4).id)).toBe(true);
  });

  it("item mais velho que a store, sem pendência: a versão não volta, e o registro ganha a marca", async () => {
    const api = fakeApi();
    api.seed("clients", { ...clientV1, version: V(3) });
    // O aparelho já confirmou a V5 (um envio daqui, lido depois da página).
    const newer = { ...clientV1, phone: "(71) 4444-0000", version: V(5) };
    const phone = await device(api, { clients: [newer] });

    expect(await phone.pull()).toBe("done");

    expect(phone.clients.confirmed.get(ID)).toEqual(newer);
    expect(phone.marks.list("clients")).toEqual([ID]);
  });
});

describe("pull: resync", () => {
  const removed = clientOf(2);
  const kept = clientOf(1);

  it.each(["cursor-expired", "invalid-cursor"])(
    "%s: do zero, o que não veio sai, e a pendência fica na fila com a base que tinha e ganha a marca",
    async (type) => {
      const api = fakeApi();
      api.seed("clients", clientV1);
      api.seed("clients", { ...kept, version: V(2) });
      api.seed("clients", { ...removed, version: V(3) });
      api.write("clients", removed, true);
      api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
      const added = clientOf(3);
      api.write("clients", added);
      const phone = await device(api, {
        clients: [clientV1, { ...kept, version: V(2) }, { ...removed, version: V(3) }],
      });
      await phone.state.cursors.set("clients", "3");
      const release = api.hold("/api/v1/clients/");
      phone.saveClient({ ...clientV1, phone: "(71) 4444-0000" });
      await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/clients/${ID}`));
      api.failNext("/api/v1/sync/clients?cursor=3", () => api.problem(type, 410));

      expect(await phone.pull()).toBe("done");

      expect(api.requests.filter((r) => r.startsWith("GET /api/v1/sync/"))).toEqual([
        "GET /api/v1/sync/clients?cursor=3",
        "GET /api/v1/sync/clients",
        "GET /api/v1/sync/properties",
        "GET /api/v1/sync/inspections",
      ]);
      expect([...phone.clients.confirmed.values()]).toEqual([
        clientV1,
        { ...kept, version: V(2) },
        { ...added, version: V(6) },
      ]);
      expect(phone.marks.list("clients")).toEqual([ID]);
      expect(await phone.outbox.peekOutbox()).toHaveLength(1);
      expect(phone.cursorRows.get("clients")).toMatchObject({ cursor: "6", complete: true });
      expect(phone.state.cursors.resyncing("clients")).toBe(false);

      // A base continua a V1: o 412 do envio faz o merge com ela, e os dois lados ficam.
      release();
      await phone.drained();
      expect(api.current("clients", ID)).toMatchObject({
        name: "Alfa Imóveis",
        phone: "(71) 4444-0000",
      });
    },
  );

  it("com pendência e excluído no servidor: fica no aparelho, com a marca", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", clientV1, true);
    const phone = await device(api, { clients: [clientV1] });
    phone.drafts.insert(draftOf("rejected"));
    await phone.state.cursors.set("clients", "1");
    api.failNext("/api/v1/sync/clients?cursor=1", () => api.problem("cursor-expired", 410));

    expect(await phone.pull()).toBe("done");

    expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
    expect(phone.drafts.get(ID)?.status).toBe("rejected");
    expect(phone.marks.list("clients")).toEqual([ID]);
  });

  it("o cursor recusado de novo no mesmo laço: o ciclo para, sem laço e sem apagar nada", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });
    await phone.state.cursors.set("clients", "1");
    api.failNext("/api/v1/sync/clients?cursor=1", () => api.problem("cursor-expired", 410));
    api.failNext("/api/v1/sync/clients", () => api.problem("invalid-cursor", 400));

    expect(await phone.pull()).toBe("failed");

    expect(api.requests).toEqual([
      "GET /api/v1/sync/clients?cursor=1",
      "GET /api/v1/sync/clients",
    ]);
    expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
    expect(phone.state.cursors.resyncing("clients")).toBe(true);
  });

  it("caiu no meio: nada sai do aparelho, e o ciclo seguinte recomeça do zero e termina a varredura", async () => {
    const api = fakeApi({ pageSize: 2 });
    const phoneHas: ClientRecord[] = [];
    for (let n = 1; n <= 5; n += 1) {
      const row = { ...clientOf(n), version: V(n) };
      api.seed("clients", row);
      phoneHas.push(row);
    }
    api.write("clients", clientOf(5), true);
    const phone = await device(api, { clients: phoneHas });
    await phone.state.cursors.set("clients", "5");
    api.failNext("/api/v1/sync/clients?cursor=5", () => api.problem("cursor-expired", 410));
    api.failNext("/api/v1/sync/clients?cursor=2", () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await phone.pull()).toBe("offline");
    expect(phone.clients.confirmed.size).toBe(5);
    expect(phone.state.cursors.resyncing("clients")).toBe(true);

    api.requests.length = 0;
    expect(await phone.pull()).toBe("done");

    expect(api.requests.filter((r) => r.includes("sync/clients"))).toEqual([
      "GET /api/v1/sync/clients",
      "GET /api/v1/sync/clients?cursor=2",
      "GET /api/v1/sync/clients?cursor=4",
    ]);
    expect([...phone.clients.confirmed.keys()]).toEqual([1, 2, 3, 4].map((n) => clientOf(n).id));
    expect(phone.state.cursors.resyncing("clients")).toBe(false);
  });
});

describe("pull: a fila segura o pull mesmo sem $hasPendingWrites (#144)", () => {
  // Na collection IndexedDB, a camada otimista solta o `$hasPendingWrites` com o envio em voo; a outbox ainda tem a
  // transação. O `get` sem a marca simula isso sobre o harness.
  const withoutPendingFlag = (phone: Awaited<ReturnType<typeof device>>) => {
    const get = phone.clients.collection.get.bind(phone.clients.collection);
    vi.spyOn(phone.clients.collection, "get").mockImplementation((id: string) => {
      const row = get(id);
      return row && { ...row, $hasPendingWrites: false };
    });
  };

  it("envio em voo: o GET da marca não sai, e a página não regrava o registro", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
    const phone = await device(api, { clients: [clientV1] });
    await phone.marks.add("clients", [ID]);
    const release = api.hold(`PUT /api/v1/clients/${ID}`);
    phone.saveClient({ ...clientV1, phone: "(71) 4444-0000" });
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/clients/${ID}`));
    withoutPendingFlag(phone);

    expect(await phone.pull()).toBe("done");

    expect(api.requests).not.toContain(`GET /api/v1/clients/${ID}`);
    expect(phone.clients.confirmed.get(ID)).toEqual(clientV1);
    expect(phone.marks.list("clients")).toEqual([ID]);
    release();
  });
});

describe("pull: resposta lida antes de uma confirmação daqui (#144)", () => {
  const phoneHere = "(71) 4444-0000";
  /** O envio confirmou e a camada otimista já soltou o registro: sem pendência, só a resposta atrasada o protege. */
  const confirmedHere = async (phone: Awaited<ReturnType<typeof device>>, id: string) => {
    await phone.drained();
    await vi.waitFor(() =>
      expect(hasPending(phone.clients.collection, phone.drafts, id)).toBe(false),
    );
  };

  it("página do delta: chega depois do envio confirmado e não volta a versão; o registro ganha a marca", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });
    const release = api.holdAfter("GET /api/v1/sync/clients");
    const pulling = phone.pull();
    await vi.waitFor(() => expect(api.requests).toContain("GET /api/v1/sync/clients"));

    phone.saveClient({ ...clientV1, phone: phoneHere });
    await confirmedHere(phone, ID);
    const confirmed = { ...clientV1, phone: phoneHere, version: V(2) };
    expect(phone.clients.confirmed.get(ID)).toEqual(confirmed);
    release();
    await pulling;

    expect(phone.clients.confirmed.get(ID)).toEqual(confirmed);
    expect(phone.marks.list("clients")).toEqual([ID]);
    // O ciclo seguinte resolve a marca pelo GET, que já tem a V2.
    await phone.pull();
    expect(phone.clients.confirmed.get(ID)).toEqual(confirmed);
    expect(phone.marks.list("clients")).toEqual([]);
  });

  it("GET da marca: chega depois do envio confirmado e é descartado; a marca fica", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });
    await phone.marks.add("clients", [ID]);
    const release = api.holdAfter(`GET /api/v1/clients/${ID}`);
    const pulling = phone.pull();
    await vi.waitFor(() => expect(api.requests).toContain(`GET /api/v1/clients/${ID}`));

    phone.saveClient({ ...clientV1, phone: phoneHere });
    await confirmedHere(phone, ID);
    release();
    await pulling;

    expect(phone.clients.confirmed.get(ID)).toEqual({ ...clientV1, phone: phoneHere, version: V(2) });
    expect(phone.marks.list("clients")).toEqual([ID]);
  });

  it("varredura do resync: o criado aqui e confirmado com o resync em voo não sai do aparelho", async () => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });
    await phone.state.cursors.set("clients", "1");
    api.failNext("/api/v1/sync/clients?cursor=1", () => api.problem("cursor-expired", 410));
    const release = api.holdAfter("GET /api/v1/sync/clients");
    const pulling = phone.pull();
    await vi.waitFor(() => expect(api.requests).toContain("GET /api/v1/sync/clients"));

    const added = clientOf(3);
    phone.saveClient(added);
    await confirmedHere(phone, added.id);
    release();
    expect(await pulling).toBe("done");

    expect(phone.clients.confirmed.get(added.id)).toEqual({ ...added, version: V(2) });
    expect(phone.marks.list("clients")).toEqual([added.id]);
  });
});

/**
 * A invariante do pull (#144): o que a pessoa salvou nunca some, e os aparelhos convergem. O roteiro de um cliente tem
 * seis posições; o pull lê o servidor numa delas (`read`) e a resposta chega numa posição igual ou posterior
 * (`deliver`), em todos os pares. Em toda posição, o registro do aparelho tem o que já foi salvo aqui; no fim, o
 * servidor e o aparelho têm o Telefone e o E-mail daqui e o Nome do outro aparelho.
 */
describe("pull: a invariante, com o pull em cada posição do roteiro (#144)", () => {
  const here = { phone: "(71) 4444-0000", email: "ana@alfa.com" };
  const elsewhere = "Alfa Imóveis";
  const positions = 6;
  const pairs = Array.from({ length: positions }, (_, read) =>
    Array.from({ length: positions - read }, (_skip, offset) => [read, read + offset] as const),
  ).flat();

  it.each(pairs)("lido na posição %i, entregue na %i", async (read, deliver) => {
    const api = fakeApi();
    api.seed("clients", clientV1);
    const phone = await device(api, { clients: [clientV1] });
    const saved: Partial<ClientRecord> = {};
    let pulling: Promise<unknown> | undefined;
    let release: (() => void) | undefined;
    // O que o formulário mostra: os campos do registro, sem as propriedades virtuais da camada otimista.
    const shown = (): ClientRecord => {
      const row = phone.clients.collection.get(ID)!;
      return Object.fromEntries(
        Object.keys(clientV1).map((key) => [key, row[key as keyof ClientRecord]]),
      ) as ClientRecord;
    };

    const steps: (() => Promise<void> | void)[] = [
      () => {
        phone.saveClient({ ...shown(), phone: here.phone });
        saved.phone = here.phone;
      },
      () => phone.drained(),
      () => {
        const current = api.current("clients", ID)!;
        api.write("clients", { ...current, name: elsewhere });
      },
      () => {
        phone.saveClient({ ...shown(), email: here.email });
        saved.email = here.email;
      },
      () => phone.drained(),
      () => {},
    ];
    for (let at = 0; at < positions; at += 1) {
      if (at === read) {
        release = api.holdAfter("GET /api/v1/sync/clients");
        const before = api.requests.length;
        pulling = phone.pull();
        await vi.waitFor(() => {
          if (!api.requests.slice(before).some((r) => r.startsWith("GET /api/v1/sync/clients")))
            throw new Error("a página de clientes ainda não foi lida");
        });
      }
      if (at === deliver) {
        release!();
        await pulling;
      }
      await steps[at]!();
      expect(phone.clients.collection.get(ID)).toMatchObject(saved);
    }

    await phone.drained();
    await phone.pull();
    await phone.pull();
    const { version: _version, ...base } = clientV1;
    expect(api.current("clients", ID)).toMatchObject({ ...base, name: elsewhere, ...here });
    expect(phone.clients.confirmed.get(ID)).toEqual(api.current("clients", ID));
    expect(phone.drafts.size).toBe(0);
    expect(phone.marks.list("clients")).toEqual([]);
  });
});
