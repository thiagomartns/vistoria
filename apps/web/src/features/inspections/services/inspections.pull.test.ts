import { afterEach, describe, expect, it, vi } from "vitest";

import { expireSession } from "@/shared/auth/session";
import { type DraftRecord, saveDraftValues } from "@/shared/sync/drafts";
import {
  DELETED_AT,
  V,
  closeDevices,
  device,
  fakeApi,
  indexedDbInspections,
} from "@/shared/sync/pull.harness";

import { INSPECTION_ENTITY, type InspectionRecord, type ItemCondition } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { DEFAULT_TEMPLATE, newMoveInInspection } from "./inspections.factory";
import { INSPECTIONS_PULL_REVISION, deleteInspection, saveInspectionDraft } from "./inspections.sync";

// O pull da vistoria (frontend.md, "Leitura (pull)"; ADR 0041 e 0043), com o harness de `shared/sync/pull.harness.ts`:
// o agregado inteiro entra por cima da store, menos a vistoria com pendência, e o rascunho limpo da tela de campo passa
// à versão nova com o mesmo passo.

vi.mock("@/shared/auth/session", () => ({
  canSendAs: () => true,
  sessionStore: { subscribe: () => () => {} },
  expireSession: vi.fn<() => void>(),
}));

afterEach(() => {
  closeDevices();
  vi.mocked(expireSession).mockClear();
  vi.restoreAllMocks();
});

const ID = "01a16032-2dfb-77de-84a2-1f165bdd9b00";
const PROPERTY = "01a16032-2dfb-77de-84a2-1f165bdd9a00";

/** A vistoria como os dois aparelhos a confirmaram (V1). */
const inspectionV1: InspectionRecord = {
  ...newMoveInInspection(PROPERTY, DEFAULT_TEMPLATE, new Date("2026-10-29T09:00:00Z")),
  id: ID,
  version: V(1),
};

/** A vistoria com a condição do item `i` do ambiente `r`. */
function marked(
  record: InspectionRecord,
  r: number,
  i: number,
  condition: ItemCondition,
): InspectionRecord {
  return {
    ...record,
    rooms: record.rooms.map((room, roomIndex) =>
      roomIndex !== r
        ? room
        : {
            ...room,
            items: room.items.map((item, itemIndex) =>
              itemIndex === i ? { ...item, condition } : item,
            ),
          },
    ),
  };
}

const conditionOf = (record: InspectionRecord | undefined, r: number, i: number) =>
  record?.rooms[r]?.items[i]?.condition;

const withoutVersion = ({ version: _version, ...rest }: InspectionRecord) => rest;

/** O aparelho com a vistoria V1 confirmada e o cursor depois dela, e o servidor com ela. */
async function known() {
  const api = fakeApi();
  api.seed("inspections", inspectionV1);
  const phone = await device(api, { inspections: [inspectionV1] });
  // O cursor de quem já tinha a V1, num build da revisão de hoje: o delta traz o que mudou depois dela, inclusive a
  // exclusão.
  await phone.state.cursors.set("inspections", "1");
  await phone.state.cursors.stamp("inspections", INSPECTIONS_PULL_REVISION);
  const store = {
    inspections: phone.inspections.collection as unknown as InspectionsCollection,
    drafts: phone.drafts,
    outbox: phone.outbox,
  };
  /** O rascunho da tela de campo com `record` no ambiente `step`. */
  const draft = (record: InspectionRecord, step = 2) =>
    saveDraftValues(phone.drafts, INSPECTION_ENTITY, ID, withoutVersion(record), step);
  return { api, phone, store, draft };
}

describe("pull da vistoria: com pendência, nada muda (ADR 0041)", () => {
  it("transação na fila: nem os items nem os deletedIds a tocam, e a serverShadow fica na V1", async () => {
    const { api, phone } = await known();
    api.write("inspections", marked(inspectionV1, 0, 1, "poor"));
    api.hold("/api/v1/inspections/");
    phone.saveInspection(marked(inspectionV1, 0, 0, "good"));
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/inspections/${ID}`));

    await phone.pull();
    expect(phone.inspections.confirmed.get(ID)).toEqual(inspectionV1);

    api.write("inspections", inspectionV1, true);
    await phone.pull();

    expect(phone.inspections.confirmed.get(ID)).toEqual(inspectionV1);
    expect(phone.inspections.acceptMutations).not.toHaveBeenCalled();
    expect(phone.marks.list("inspections")).toEqual([ID]);
  });

  it.each<[string, (draft: DraftRecord) => DraftRecord]>([
    ["rascunho com o que a pessoa marcou e não foi para a fila", (draft) => draft],
    ["rascunho recusado", (draft) => ({ ...draft, status: "rejected" })],
    [
      "rascunho em conflito",
      (draft) => ({ ...draft, status: "conflict", conflict: { current: {}, collisions: [] } }),
    ],
  ])("%s: nem a store nem o rascunho mudam, e a vistoria ganha a marca", async (_name, as) => {
    const { api, phone, draft } = await known();
    draft(marked(inspectionV1, 0, 0, "good"));
    const saved = as(phone.drafts.get(ID)!);
    phone.drafts.update(ID, (current) => {
      Object.assign(current, saved);
    });
    api.write("inspections", marked(inspectionV1, 0, 1, "poor"));
    api.write("inspections", inspectionV1, true);

    await phone.pull();

    expect(phone.inspections.confirmed.get(ID)).toEqual(inspectionV1);
    expect(phone.drafts.get(ID)).toMatchObject({ status: saved.status, step: 2 });
    expect(phone.drafts.get(ID)).not.toHaveProperty("rebasedAt");
    expect(conditionOf(phone.drafts.get(ID)!.data as InspectionRecord, 0, 0)).toBe("good");
    expect(phone.marks.list("inspections")).toEqual([ID]);
  });

  it("exclusão na fila (deleting): os items não a trazem de volta", async () => {
    const { api, phone, store } = await known();
    api.write("inspections", marked(inspectionV1, 0, 1, "poor"));
    api.hold("/api/v1/inspections/");
    await deleteInspection(store, ID);

    await phone.pull();

    expect(phone.inspections.collection.get(ID)?.deleting).toBe(true);
    expect(phone.inspections.confirmed.get(ID)).toEqual(inspectionV1);
    expect(phone.marks.list("inspections")).toEqual([ID]);
  });

  it("não perder: o item marcado aqui na fila e o item do outro aparelho no pull ficam os dois, pelo 412", async () => {
    const { api, phone } = await known();
    const release = api.hold("/api/v1/inspections/");
    phone.saveInspection(marked(inspectionV1, 0, 0, "good"));
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/inspections/${ID}`));
    // O outro aparelho muda outro item enquanto o envio daqui está em voo.
    api.write("inspections", marked(inspectionV1, 1, 0, "poor"));

    await phone.pull();
    expect(phone.inspections.confirmed.get(ID)).toEqual(inspectionV1);

    release();
    await phone.drained();

    const server = api.current("inspections", ID) as InspectionRecord;
    expect(conditionOf(server, 0, 0)).toBe("good");
    expect(conditionOf(server, 1, 0)).toBe("poor");
    expect(phone.drafts.get(ID)?.status).not.toBe("conflict");

    // A marca sai no ciclo seguinte: a store fica com o que os dois gravaram.
    await phone.pull();
    expect(phone.inspections.confirmed.get(ID)?.version).toBe(server.version);
    expect(phone.marks.list("inspections")).toEqual([]);
  });

  it("PUT na fila e a vistoria em deletedIds: fica no aparelho, e o envio cai no 410 (excluída em outro aparelho)", async () => {
    const { api, phone } = await known();
    const release = api.hold("/api/v1/inspections/");
    phone.saveInspection(marked(inspectionV1, 0, 0, "good"));
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/inspections/${ID}`));
    api.write("inspections", inspectionV1, true);

    await phone.pull();
    expect(phone.inspections.collection.has(ID)).toBe(true);
    expect(phone.inspections.confirmed.get(ID)).toEqual(inspectionV1);

    release();
    await phone.drained();

    expect(phone.drafts.get(ID)).toMatchObject({
      status: "conflict",
      conflict: { type: "deleted", deletedAt: DELETED_AT },
    });
    expect(phone.inspections.collection.has(ID)).toBe(true);
  });
});

describe("pull da vistoria: sem pendência (ADR 0043)", () => {
  it("o agregado inteiro entra na store, e o rascunho limpo passa à versão nova com o mesmo passo", async () => {
    const { api, phone, draft } = await known();
    draft(inspectionV1);
    const remote = marked(marked(inspectionV1, 0, 1, "poor"), 2, 0, "fair");
    api.write("inspections", remote);

    expect(await phone.pull()).toBe("done");

    expect(phone.inspections.confirmed.get(ID)).toEqual({ ...remote, version: V(2) });
    expect(phone.drafts.get(ID)).toMatchObject({
      status: "draft",
      step: 2,
      data: withoutVersion(remote),
      rebasedAt: expect.any(String),
    });
    expect(phone.marks.list("inspections")).toEqual([]);
    expect(await phone.outbox.peekOutbox()).toHaveLength(0);
  });

  it("sem rascunho: a versão nova entra, e nenhum rascunho nasce", async () => {
    const { api, phone } = await known();
    api.write("inspections", marked(inspectionV1, 0, 1, "poor"));

    await phone.pull();

    expect(conditionOf(phone.inspections.collection.get(ID), 0, 1)).toBe("poor");
    expect(phone.drafts.has(ID)).toBe(false);
  });

  it("em deletedIds: sai da store e o rascunho limpo sai junto", async () => {
    const { api, phone, draft } = await known();
    draft(inspectionV1);
    await phone.pull();
    api.write("inspections", inspectionV1, true);

    await phone.pull();

    expect(phone.inspections.confirmed.has(ID)).toBe(false);
    expect(phone.inspections.collection.has(ID)).toBe(false);
    expect(phone.drafts.has(ID)).toBe(false);
  });

  it("a vistoria vem depois do imóvel dela: os laços seguem a ordem de criação", async () => {
    const { api, phone } = await known();

    await phone.pull();

    expect(api.requests.filter((r) => r.startsWith("GET /api/v1/sync/"))).toEqual([
      "GET /api/v1/sync/clients",
      "GET /api/v1/sync/properties",
      "GET /api/v1/sync/templates",
      "GET /api/v1/sync/inspections?cursor=1",
    ]);
  });
});

// #211: a tela de campo monta o que salva espalhando a linha da live query (`recordWith`), e a linha vem com as props
// virtuais do TanStack DB. Criada offline, a vistoria ainda é otimista, então a cópia levava `$hasPendingWrites: true`
// ao rascunho, à fila e, no aceite, à store confirmada. Como o TanStack DB prefere a prop que a linha já tem, ela ficava
// "com pendência" para sempre, e o pull nunca mais a tocava.
describe("pull da vistoria criada no aparelho (#211)", () => {
  const hasVirtualProps = (row: object | undefined) =>
    Object.keys(row ?? {}).some((key) => key.startsWith("$"));

  /** O celular com a collection por id de verdade, sobre IndexedDB, e o cursor no fim do servidor. */
  async function phoneOn(api: ReturnType<typeof fakeApi>, initial: InspectionRecord[] = []) {
    const local = await indexedDbInspections(initial);
    const phone = await device(api, { indexedDb: local });
    const store = {
      inspections: local.collection as unknown as InspectionsCollection,
      drafts: phone.drafts,
      outbox: phone.outbox,
    };
    return { local, phone, store };
  }

  it("salva da linha otimista: a fila esvazia, o rascunho fica limpo e o pull aplica a versão do outro aparelho", async () => {
    const api = fakeApi();
    const { local, phone, store } = await phoneOn(api);
    const created = { ...inspectionV1, version: null };

    // A tela de campo cria a vistoria e, com ela ainda na fila, grava o rascunho e salva de novo a partir da linha
    // da live query, como o `recordWith` faz: a linha otimista leva `$hasPendingWrites: true`.
    phone.saveInspection(created);
    const live = store.inspections.get(ID)!;
    expect(live.$hasPendingWrites).toBe(true);
    const fromScreen = withoutVersion({ ...live, ...marked(created, 0, 0, "good") });
    saveInspectionDraft(store, fromScreen, 2);
    phone.saveInspection({ ...fromScreen, version: null });
    // As duas escritas chegam ao servidor (a primeira, se não foi compactada, cria a V1; a segunda, a V2), e o aceite
    // da última grava a versão dela.
    await vi.waitFor(
      () => {
        expect(api.current("inspections", ID)?.rooms).toEqual(fromScreen.rooms);
        expect(store.inspections.get(ID)?.version).toBe(api.current("inspections", ID)?.version);
      },
      { timeout: 5_000 },
    );
    await phone.drained();
    const sent = api.current("inspections", ID) as InspectionRecord;
    expect(phone.drafts.get(ID)?.status).toBe("draft");

    expect(hasVirtualProps(sent), "o PUT não leva as props virtuais").toBe(false);
    expect(hasVirtualProps((await local.stores()).records[0])).toBe(false);
    expect(hasVirtualProps(phone.drafts.get(ID)?.data)).toBe(false);
    expect(store.inspections.get(ID)?.$hasPendingWrites).toBe(false);

    // O notebook escreve uma observação; o pull do celular a aplica e não deixa marca.
    await phone.pull();
    const remote = marked(sent, 1, 1, "poor");
    const version = api.write("inspections", remote);
    expect(await phone.pull()).toBe("done");

    expect(store.inspections.get(ID)?.version).toBe(version);
    expect(conditionOf(store.inspections.get(ID), 1, 1)).toBe("poor");
    expect(phone.drafts.get(ID)).toMatchObject({ status: "draft", step: 2, rebasedAt: expect.any(String) });
    expect(conditionOf(phone.drafts.get(ID)?.data as InspectionRecord, 1, 1)).toBe("poor");
    expect(phone.marks.list("inspections")).toEqual([]);
  });

  it("a linha que um aparelho de antes gravou com as props virtuais entra limpa, e o pull a aplica", async () => {
    const api = fakeApi();
    api.seed("inspections", inspectionV1);
    const { local, phone, store } = await phoneOn(api);
    await local.putRaw({ ...inspectionV1, $hasPendingWrites: true, $origin: "local" });
    await phone.state.cursors.set("inspections", "1");
    // A tela de campo aberta: a vistoria está na memória.
    await local.collection.utils.load([ID]);
    expect(store.inspections.get(ID)?.$hasPendingWrites).toBe(false);

    const remote = marked(inspectionV1, 0, 1, "poor");
    const version = api.write("inspections", remote);
    expect(await phone.pull()).toBe("done");

    expect(conditionOf(store.inspections.get(ID), 0, 1)).toBe("poor");
    const [stored] = (await local.stores()).records;
    expect(stored).toEqual({ ...remote, version });
    expect(phone.marks.list("inspections")).toEqual([]);
  });
});

describe("pull da vistoria: a revisão 2 traz a cópia da conclusão às concluídas que o aparelho já tem (ADR 0068)", () => {
  const completedSnapshot = {
    property: {
      street: "Rua das Flores",
      number: "120",
      complement: "ap 32",
      district: "Jardim Paulista",
      city: "São Paulo",
      state: "SP",
      zipCode: "01400000",
      type: "apartment" as const,
    },
    client: { name: "Imobiliária Horizonte", document: "11222333000181" },
  };
  /** A concluída como a migração a deixou no servidor: com a cópia, numa versão nova (V2). */
  const completed: InspectionRecord = {
    ...inspectionV1,
    status: "completed",
    version: V(2),
    completedAt: "2026-10-29T10:00:00+00:00",
    completedBy: { id: "u1", name: "Thiago Martins" },
    completedSnapshot,
  };
  /** A mesma V2 no aparelho de um build de antes, que descartou a chave nova e avançou o cursor. */
  const { completedSnapshot: _dropped, ...withoutSnapshot } = completed;

  it("cursor de antes das revisões: puxa do zero uma vez e regrava a concluída da mesma versão, agora com a cópia", async () => {
    const api = fakeApi();
    api.seed("inspections", completed);
    const phone = await device(api, { inspections: [withoutSnapshot] });
    await phone.state.cursors.set("inspections", "2", true);

    expect(await phone.pull()).toBe("done");

    expect(api.requests).toContain("GET /api/v1/sync/inspections");
    expect(phone.inspections.confirmed.get(ID)).toEqual(completed);
    expect(phone.state.cursors.revision("inspections")).toBe(2);
    expect(phone.state.cursors.resyncing("inspections")).toBe(false);

    // Feito uma vez: o ciclo seguinte segue do cursor.
    api.requests.length = 0;
    expect(await phone.pull()).toBe("done");
    expect(api.requests).toContain("GET /api/v1/sync/inspections?cursor=2");
    expect(api.requests).not.toContain("GET /api/v1/sync/inspections");
  });

  it("o resync da revisão que cai no meio recomeça no ciclo seguinte, e só então a revisão é gravada", async () => {
    const api = fakeApi();
    api.seed("inspections", completed);
    const phone = await device(api, { inspections: [withoutSnapshot] });
    await phone.state.cursors.set("inspections", "2", true);
    api.failNext("/api/v1/sync/inspections", () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await phone.pull()).toBe("offline");
    expect(phone.state.cursors.resyncing("inspections")).toBe(true);
    expect(phone.state.cursors.revision("inspections")).toBe(1);

    expect(await phone.pull()).toBe("done");
    expect(phone.inspections.confirmed.get(ID)).toEqual(completed);
    expect(phone.state.cursors.revision("inspections")).toBe(2);
  });

  it("aparelho novo: o primeiro sync já grava a revisão 2, sem resync depois", async () => {
    const api = fakeApi();
    api.seed("inspections", completed);
    const phone = await device(api);

    expect(await phone.pull()).toBe("done");
    expect(phone.inspections.confirmed.get(ID)).toEqual(completed);
    expect(phone.state.cursors.revision("inspections")).toBe(2);

    api.requests.length = 0;
    await phone.pull();
    expect(api.requests).not.toContain("GET /api/v1/sync/inspections");
  });

  it("os laços sem revisão (clientes) não puxam de novo", async () => {
    const api = fakeApi();
    api.seed("inspections", completed);
    const phone = await device(api, { inspections: [completed] });
    await phone.state.cursors.set("clients", "0", true);
    await phone.state.cursors.set("inspections", "2", true);
    await phone.state.cursors.stamp("inspections", INSPECTIONS_PULL_REVISION);

    await phone.pull();

    expect(api.requests).toContain("GET /api/v1/sync/clients?cursor=0");
    expect(api.requests).toContain("GET /api/v1/sync/inspections?cursor=2");
  });
});
