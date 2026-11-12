import { afterEach, describe, expect, it, vi } from "vitest";

import { V, closeDevices, device, fakeApi } from "@/shared/sync/pull.harness";

import type { TemplateRecord } from "../models/template";

// O roteiro na outbox única (#172), com o executor e a mutationFn de verdade (harness de `pull.harness.ts`): o que foi
// criado e editado sem poder enviar sai num `PUT` só, compactado na transação mais nova (frontend.md, "Escrita (push)").

let canSend = true;

vi.mock("@/shared/auth/session", () => ({
  canSendAs: () => canSend,
  sessionStore: { subscribe: () => () => {} },
  expireSession: vi.fn<() => void>(),
}));

afterEach(() => {
  closeDevices();
  canSend = true;
  vi.restoreAllMocks();
});

const ID = "01a16032-2dfb-77de-84a2-1f165bdd9b01";
const created: TemplateRecord = {
  id: ID,
  version: null,
  name: "Casa térrea",
  rooms: [
    {
      id: "01a16032-2dfb-77de-84a2-1f165bdd9c01",
      name: "Sala",
      position: 0,
      items: [{ id: "01a16032-2dfb-77de-84a2-1f165bdd9d01", name: "Piso", position: 0 }],
    },
  ],
};
const edited: TemplateRecord = {
  ...created,
  name: "Casa térrea com quintal",
  rooms: [
    ...created.rooms,
    {
      id: "01a16032-2dfb-77de-84a2-1f165bdd9c02",
      name: "Quintal",
      position: 1,
      items: [{ id: "01a16032-2dfb-77de-84a2-1f165bdd9d02", name: "Muro", position: 0 }],
    },
  ],
};

describe("outbox: roteiros", () => {
  it("criar e editar sem poder enviar: um PUT só, com a edição, e a store na versão do servidor", async () => {
    const api = fakeApi();
    const phone = await device(api);
    canSend = false;

    phone.saveTemplate(created);
    phone.saveTemplate(edited);

    expect(phone.templates.collection.get(ID)).toMatchObject({
      name: edited.name,
      rooms: edited.rooms,
    });
    // As duas na fila, nenhuma tentada: só a mais nova sai (compactação).
    await vi.waitFor(async () => expect(await phone.outbox.peekOutbox()).toHaveLength(2));
    expect(api.requests).toEqual([]);

    canSend = true;
    phone.outbox.getOnlineDetector().notifyOnline();
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/templates/${ID}`));
    await phone.drained();

    expect(api.requests).toEqual([`PUT /api/v1/templates/${ID}`]);
    const { id: _id, version: _version, ...body } = edited;
    expect(api.current("templates", ID)).toEqual({ ...body, id: ID, version: V(1) });
    expect(phone.templates.confirmed.get(ID)).toEqual({ ...edited, version: V(1) });
  });

  it("editar um roteiro confirmado: o PUT leva If-Match com a version da store, e o servidor aceita", async () => {
    const api = fakeApi();
    const confirmed = { ...created, version: V(1) };
    api.seed("templates", confirmed);
    const phone = await device(api, { templates: [confirmed] });

    phone.saveTemplate({ ...edited, version: V(1) });
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/templates/${ID}`));
    await phone.drained();

    // O servidor falso responde 412 a um If-Match que não é o da versão dele: a V2 é o PUT aceito.
    expect(api.requests).toEqual([`PUT /api/v1/templates/${ID}`]);
    expect(api.current("templates", ID)?.version).toBe(V(2));
    expect(phone.templates.confirmed.get(ID)).toEqual({ ...edited, version: V(2) });
    expect(phone.drafts.get(ID)).toBeUndefined();
  });
});
