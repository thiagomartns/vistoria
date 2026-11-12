import { afterEach, describe, expect, it, vi } from "vitest";

import { V, closeDevices, device, fakeApi } from "@/shared/sync/pull.harness";

import type { TemplateRecord } from "../models/template";

// O laço de roteiros no pull (#172), com o harness de `pull.harness.ts`: a outbox e a mutationFn de verdade, a camada
// otimista do TanStack DB e um servidor falso que pagina o delta. O caminho é o mesmo de clientes e imóveis (ADR 0041
// a 0044); aqui, o que prova que os roteiros estão nele.

vi.mock("@/shared/auth/session", () => ({
  canSendAs: () => true,
  sessionStore: { subscribe: () => () => {} },
  expireSession: vi.fn<() => void>(),
}));

afterEach(() => {
  closeDevices();
  vi.restoreAllMocks();
});

const templateOf = (n: number, version: string | null = V(n)): TemplateRecord => ({
  id: `01a16032-2dfb-77de-84a2-1f165bdd9b${String(n).padStart(2, "0")}`,
  version,
  name: `Roteiro ${n}`,
  rooms: [
    {
      id: `01a16032-2dfb-77de-84a2-1f165bdd9c${String(n).padStart(2, "0")}`,
      name: "Sala",
      position: 0,
      items: [
        {
          id: `01a16032-2dfb-77de-84a2-1f165bdd9d${String(n).padStart(2, "0")}`,
          name: "Piso",
          position: 0,
        },
      ],
    },
  ],
});

const apartment = templateOf(1);
const ID = apartment.id;

describe("pull: roteiros", () => {
  it("delta: o editado e o novo chegam, o excluído sai, e o laço roda depois dos imóveis e antes das vistorias", async () => {
    const api = fakeApi();
    const removed = templateOf(2);
    api.seed("templates", apartment);
    api.seed("templates", removed);
    api.write("templates", { ...apartment, name: "Apartamento grande" });
    api.write("templates", removed, true);
    const added = templateOf(5, null);
    api.write("templates", added);
    const phone = await device(api, { templates: [apartment, removed] });
    await phone.state.cursors.set("templates", "2");

    expect(await phone.pull()).toBe("done");

    expect([...phone.templates.confirmed.values()]).toEqual([
      { ...apartment, name: "Apartamento grande", version: V(3) },
      { ...added, version: V(5) },
    ]);
    expect(phone.templates.collection.get(ID)?.name).toBe("Apartamento grande");
    expect(api.requests).toEqual([
      "GET /api/v1/sync/clients",
      "GET /api/v1/sync/properties",
      "GET /api/v1/sync/templates?cursor=2",
      "GET /api/v1/sync/inspections",
    ]);
    expect(phone.cursorRows.get("templates")).toMatchObject({ cursor: "5", complete: true });
  });

  it("os ambientes e os itens chegam na ordem da posição", async () => {
    const api = fakeApi();
    const [room] = apartment.rooms;
    const shuffled = {
      ...apartment,
      rooms: [
        { ...room!, id: `${room!.id.slice(0, -2)}f1`, name: "Cozinha", position: 1 },
        {
          ...room!,
          items: [
            { id: `${room!.items[0]!.id.slice(0, -2)}f2`, name: "Teto", position: 1 },
            room!.items[0]!,
          ],
        },
      ],
    };
    api.write("templates", shuffled);
    const phone = await device(api);

    expect(await phone.pull()).toBe("done");

    const pulled = phone.templates.confirmed.get(ID)!;
    expect(pulled.rooms.map((r) => r.name)).toEqual(["Sala", "Cozinha"]);
    expect(pulled.rooms[0]!.items.map((i) => i.name)).toEqual(["Piso", "Teto"]);
  });

  it.each(["cursor-expired", "invalid-cursor"])(
    "%s: do zero, o roteiro que não veio sai do aparelho",
    async (type) => {
      const api = fakeApi();
      const removed = templateOf(2);
      api.seed("templates", apartment);
      api.seed("templates", removed);
      api.write("templates", removed, true);
      const phone = await device(api, { templates: [apartment, removed] });
      await phone.state.cursors.set("templates", "2");
      api.failNext("/api/v1/sync/templates?cursor=2", () => api.problem(type, 410));

      expect(await phone.pull()).toBe("done");

      expect(api.requests.filter((r) => r.includes("/sync/templates"))).toEqual([
        "GET /api/v1/sync/templates?cursor=2",
        "GET /api/v1/sync/templates",
      ]);
      expect([...phone.templates.confirmed.values()]).toEqual([apartment]);
      expect(phone.cursorRows.get("templates")).toMatchObject({ complete: true });
      expect(phone.state.cursors.resyncing("templates")).toBe(false);
    },
  );

  it("pendência protegida: com o roteiro na fila, a página não grava, ele ganha a marca, e o 412 converge os dois lados", async () => {
    const api = fakeApi();
    api.seed("templates", apartment);
    const phone = await device(api, { templates: [apartment] });
    await phone.state.cursors.set("templates", "1");
    const release = api.hold(`/api/v1/templates/${ID}`);
    phone.saveTemplate({ ...apartment, name: "Apartamento padrão" });
    await vi.waitFor(() => expect(api.requests).toContain(`PUT /api/v1/templates/${ID}`));
    // Outro aparelho acrescentou um item à Sala.
    const [room] = apartment.rooms;
    const ceiling = { id: `${room!.items[0]!.id.slice(0, -2)}e1`, name: "Teto", position: 1 };
    const otherRooms = [{ ...room!, items: [...room!.items, ceiling] }];
    api.write("templates", { ...apartment, rooms: otherRooms });

    expect(await phone.pull()).toBe("done");

    expect(phone.templates.confirmed.get(ID)).toEqual(apartment);
    expect(phone.marks.list("templates")).toEqual([ID]);
    expect(await phone.outbox.peekOutbox()).toHaveLength(1);

    // A base continua a V1: o 412 do envio faz o merge com ela, e o nome daqui e o item de lá ficam.
    release();
    await phone.drained();
    expect(api.current("templates", ID)).toMatchObject({
      name: "Apartamento padrão",
      rooms: otherRooms,
    });
    expect(phone.templates.confirmed.get(ID)).toMatchObject({
      name: "Apartamento padrão",
      rooms: otherRooms,
      version: api.current("templates", ID)!.version,
    });
  });
});
