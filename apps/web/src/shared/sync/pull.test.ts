import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";

import { expireSession } from "../auth/session";
import type { DraftRecord } from "./drafts";
import type { CursorStore } from "./pull";
import { closeDevices, device, fakeApi, stopLater } from "./pull.harness";
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
  version: "V1",
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
    expect(phone.clients.confirmed.get(ID)?.version).toBe("V1");

    release();
    await phone.drained();
    const merged = { ...clientV1, name: "Alfa Imóveis", phone: "(71) 4444-0000" };
    expect(api.current("clients", ID)).toEqual({ ...merged, version: "V3" });
    expect(phone.drafts.size).toBe(0);

    // A marca sai no ciclo seguinte, pelo GET: a store fica com o que os dois gravaram.
    await phone.pull();
    expect(phone.clients.confirmed.get(ID)).toEqual({ ...merged, version: "V3" });
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
      version: "V2",
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
    api.seed("clients", { ...removed, version: "V2" });
    api.write("clients", { ...clientV1, email: "vendas@alfa.com" });
    api.write("clients", removed, true);
    const property = propertyOf(ID);
    api.write("properties", property);
    const phone = await device(api, { clients: [clientV1, { ...removed, version: "V2" }] });
    // A partir do cursor de quem já tinha a V1 e a V2.
    await phone.state.cursors.set("clients", "2");

    expect(await phone.pull()).toBe("done");

    expect([...phone.clients.confirmed.values()]).toEqual([
      { ...clientV1, email: "vendas@alfa.com", version: "V3" },
    ]);
    expect([...phone.properties.confirmed.values()]).toEqual([{ ...property, version: "V5" }]);
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
describe("pull: resync", () => {
  const removed = clientOf(2);
  const kept = clientOf(1);

  it.each(["cursor-expired", "invalid-cursor"])(
    "%s: do zero, o que não veio sai, e a pendência fica na fila com a base que tinha e ganha a marca",
    async (type) => {
      const api = fakeApi();
      api.seed("clients", clientV1);
      api.seed("clients", { ...kept, version: "V2" });
      api.seed("clients", { ...removed, version: "V3" });
      api.write("clients", removed, true);
      api.write("clients", { ...clientV1, name: "Alfa Imóveis" });
      const added = clientOf(3);
      api.write("clients", added);
      const phone = await device(api, {
        clients: [clientV1, { ...kept, version: "V2" }, { ...removed, version: "V3" }],
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
        { ...kept, version: "V2" },
        { ...added, version: "V6" },
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
      const row = { ...clientOf(n), version: `V${n}` };
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
