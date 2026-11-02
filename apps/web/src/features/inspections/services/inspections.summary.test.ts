import { afterEach, describe, expect, it, vi } from "vitest";

import { expireSession } from "@/shared/auth/session";
import { V, closeDevices, device, fakeApi, indexedDbInspections } from "@/shared/sync/pull.harness";

import type { InspectionRecord, ItemCondition } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import { summaryOf } from "./inspections.summary";
import { deleteInspection } from "./inspections.sync";

// O resumo e a vistoria nunca divergem (ADR 0048): a collection por id de verdade, sobre um IndexedDB em memória, no
// harness do pull. Cada caminho que grava a store confirmada (página do pull, varredura do resync, envio aceito, 412
// adotado, exclusão) grava o resumo na mesma transação, e um ciclo que cai no meio deixa as duas stores iguais.

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

const PROPERTY = "01a16032-2dfb-77de-84a2-1f165bdd9a00";

/** A vistoria `n`, confirmada na versão `version`. */
const inspectionOf = (n: number, version = V(n)): InspectionRecord => ({
  ...newMoveInInspection(PROPERTY, new Date(Date.UTC(2026, 9, 29, 9, n))),
  id: `01a16032-2dfb-77de-84a2-1f165bdd9b${String(n).padStart(2, "0")}`,
  version,
});

/** A vistoria com a condição do item `i` do ambiente `r`. */
function marked(record: InspectionRecord, r: number, i: number, condition: ItemCondition) {
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

/** Espera o servidor aceitar a vistoria `id`: a fila esvazia só depois de a transação entrar nela. */
const sent = (api: ReturnType<typeof fakeApi>, id: string) =>
  vi.waitFor(() => expect(api.current("inspections", id)?.version).toBeTruthy(), {
    timeout: 5_000,
  });

const withoutVersion = ({ version: _version, ...rest }: InspectionRecord) => rest;

/** O aparelho com as vistorias na collection por id, sobre IndexedDB. */
async function phoneWith(api: ReturnType<typeof fakeApi>, inspections: InspectionRecord[] = []) {
  const local = await indexedDbInspections(inspections);
  const phone = await device(api, { indexedDb: local });
  const store = {
    inspections: local.collection as unknown as InspectionsCollection,
    drafts: phone.drafts,
    outbox: phone.outbox,
  };
  return { phone, local, store };
}

describe("resumo e vistoria nunca divergem (ADR 0048)", () => {
  it("pull em várias páginas: cada vistoria entra com o seu resumo, e a excluída sai das duas stores", async () => {
    const api = fakeApi({ pageSize: 2 });
    for (let n = 1; n <= 5; n += 1) api.write("inspections", inspectionOf(n));
    const { phone, local } = await phoneWith(api);

    expect(await phone.pull()).toBe("done");
    await local.expectInSync();
    expect((await local.stores()).summaries).toHaveLength(5);
    // A página entra na store sem abrir as vistorias na memória: só uma consulta por id as carrega.
    expect(local.collection.size).toBe(0);

    const changed = marked(inspectionOf(2), 0, 0, "poor");
    api.write("inspections", changed);
    api.write("inspections", inspectionOf(4), true);
    expect(await phone.pull()).toBe("done");

    await local.expectInSync();
    const { summaries } = await local.stores();
    expect(summaries.map((summary) => summary.id)).not.toContain(inspectionOf(4).id);
    expect(summaries.find((summary) => summary.id === changed.id)).toMatchObject({ evaluated: 1 });
  });

  it("envio aceito: a criada e a editada no aparelho entram nas duas stores com a versão do servidor", async () => {
    const api = fakeApi();
    const known = inspectionOf(1);
    api.seed("inspections", known);
    const { phone, local, store } = await phoneWith(api, [known]);
    // A tela de campo carrega a vistoria pelo id antes de editar.
    await local.collection.utils.load([known.id]);

    phone.saveInspection(marked(known, 0, 0, "good"));
    phone.saveInspection(inspectionOf(2, null as never));
    await sent(api, inspectionOf(2).id);
    await phone.drained();

    await local.expectInSync();
    const { records } = await local.stores();
    expect(records.map((record) => record.version)).toEqual([
      api.current("inspections", known.id)!.version,
      api.current("inspections", inspectionOf(2).id)!.version,
    ]);
    expect(store.inspections.get(known.id)?.rooms[0]?.items[0]?.condition).toBe("good");
  });

  it("412 adotado: o current do servidor e o reenvio mesclado passam pelas duas stores juntas", async () => {
    const api = fakeApi();
    const known = inspectionOf(1);
    api.seed("inspections", known);
    const { phone, local } = await phoneWith(api, [known]);
    await local.collection.utils.load([known.id]);
    // O outro aparelho muda outro item antes do envio daqui.
    api.write("inspections", marked(known, 1, 0, "poor"));

    phone.saveInspection(marked(known, 0, 0, "good"));
    await vi.waitFor(() =>
      expect(
        (api.current("inspections", known.id) as InspectionRecord).rooms[0]?.items[0]?.condition,
      ).toBe("good"),
    );
    await phone.drained();

    const server = api.current("inspections", known.id) as InspectionRecord;
    expect(server.rooms[0]?.items[0]?.condition).toBe("good");
    expect(server.rooms[1]?.items[0]?.condition).toBe("poor");
    await local.expectInSync();
    const { summaries } = await local.stores();
    expect(summaries).toEqual([summaryOf({ ...server, version: server.version })]);
  });

  it("exclusão pela lista, sem a vistoria na memória: o 204 a tira das duas stores", async () => {
    const api = fakeApi();
    const known = inspectionOf(1);
    api.seed("inspections", known);
    const { phone, local, store } = await phoneWith(api, [known, inspectionOf(2)]);
    expect(local.collection.has(known.id)).toBe(false);

    await deleteInspection(store, known.id);
    expect(store.inspections.get(known.id)?.deleting).toBe(true);
    await phone.drained();

    expect(api.requests).toContain(`DELETE /api/v1/inspections/${known.id}`);
    await local.expectInSync();
    expect((await local.stores()).records.map((record) => record.id)).toEqual([inspectionOf(2).id]);
  });

  it("resync com varredura: o que não veio do zero sai das duas stores", async () => {
    const api = fakeApi({ pageSize: 2 });
    for (let n = 1; n <= 4; n += 1) api.write("inspections", inspectionOf(n));
    const { phone, local } = await phoneWith(api);
    expect(await phone.pull()).toBe("done");
    api.write("inspections", inspectionOf(3), true);
    api.failNext("/api/v1/sync/inspections?cursor=", () => api.problem("cursor-expired", 410));

    expect(await phone.pull()).toBe("done");

    expect(phone.state.cursors.resyncing("inspections")).toBe(false);
    await local.expectInSync();
    expect((await local.stores()).records.map((record) => record.id)).toEqual(
      [1, 2, 4].map((n) => inspectionOf(n).id),
    );
  });

  it("resync que cai no meio: a página aplicada deixa as duas stores iguais, e o ciclo seguinte termina", async () => {
    const api = fakeApi({ pageSize: 2 });
    for (let n = 1; n <= 5; n += 1) api.write("inspections", inspectionOf(n));
    const { phone, local } = await phoneWith(api);
    expect(await phone.pull()).toBe("done");
    api.write("inspections", marked(inspectionOf(1), 0, 0, "fair"));
    api.write("inspections", inspectionOf(5), true);
    api.failNext("/api/v1/sync/inspections?cursor=", () => api.problem("cursor-expired", 410));
    // Do zero, a primeira página traz a 2 e a 3 (a 1 mudou depois): o cursor dela é o da 3.
    api.failNext("/api/v1/sync/inspections?cursor=3", () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await phone.pull()).toBe("offline");
    expect(phone.state.cursors.resyncing("inspections")).toBe(true);
    await local.expectInSync();

    expect(await phone.pull()).toBe("done");
    await local.expectInSync();
    const { summaries } = await local.stores();
    expect(summaries.map((summary) => summary.id)).toEqual(
      [1, 2, 3, 4].map((n) => inspectionOf(n).id),
    );
    expect(summaries[0]).toMatchObject({ evaluated: 1 });
  });

  it("o rascunho limpo da tela de campo não segura o pull de uma vistoria fora da memória", async () => {
    const api = fakeApi();
    const known = inspectionOf(1);
    api.seed("inspections", known);
    const { phone, local } = await phoneWith(api, [known]);
    await phone.state.cursors.set("inspections", "1");
    // A tela de campo gravou o rascunho ao abrir e foi fechada: a vistoria saiu da consulta.
    const { saveDraftValues } = await import("@/shared/sync/drafts");
    saveDraftValues(phone.drafts, "inspection", known.id, withoutVersion(known), 1);
    const changed = marked(known, 0, 1, "poor");
    api.write("inspections", changed);

    expect(await phone.pull()).toBe("done");

    expect(phone.marks.list("inspections")).toEqual([]);
    await local.expectInSync();
    expect((await local.stores()).records[0]?.rooms[0]?.items[1]?.condition).toBe("poor");
  });
});
