import { afterEach, describe, expect, it, vi } from "vitest";

import { expireSession } from "@/shared/auth/session";
import { type DraftRecord, saveDraftValues } from "@/shared/sync/drafts";
import { DELETED_AT, V, closeDevices, device, fakeApi } from "@/shared/sync/pull.harness";

import { INSPECTION_ENTITY, type InspectionRecord, type ItemCondition } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import { deleteInspection } from "./inspections.sync";

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
  ...newMoveInInspection(PROPERTY, new Date("2026-10-29T09:00:00Z")),
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
  // O cursor de quem já tinha a V1: o delta traz o que mudou depois dela, inclusive a exclusão.
  await phone.state.cursors.set("inspections", "1");
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
      "GET /api/v1/sync/inspections?cursor=1",
    ]);
  });
});
