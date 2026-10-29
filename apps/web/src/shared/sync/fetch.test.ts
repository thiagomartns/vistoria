// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { expireSession } from "../auth/session";
import type { DraftsCollection } from "./drafts";
import { type GetCall, fetchMissing } from "./fetch";
import type { LocalCollection } from "./upsert";

// A leitura por id com um GET falso e uma store em memória: o que é gravado, o que nunca é pedido nem sobrescrito e a
// reação a cada falha, escolhida pelo `type`.

vi.mock("../auth/session", () => ({ expireSession: vi.fn<() => void>() }));

type Row = { id: string; version: string | null; name: string };
type Dto = Row & { createdAt: string };

const id = "01a16032-2dfb-77de-84a2-1f165bdd993e";
const dto: Dto = {
  id,
  version: "AAAAAAAAB9M=",
  name: "Do servidor",
  createdAt: "2026-10-29T00:00:00Z",
};
const shape = ({ createdAt: _createdAt, ...row }: Dto): Row => row;

/** A store confirmada e a camada otimista por cima (o que está na fila), como na collection do TanStack DB. */
function setup({ queued = [] as Row[], drafted = [] as string[] } = {}) {
  const confirmed = new Map<string, Row>();
  const optimistic = new Map(queued.map((row) => [row.id, row]));
  const acceptMutations = vi.fn<
    (transaction: { mutations: { type: string; modified: Row }[] }) => Promise<void>
  >(async ({ mutations }) => {
    for (const { type, modified } of mutations) {
      if (type === "delete") confirmed.delete(modified.id);
      else confirmed.set(modified.id, modified);
    }
  });
  const store = {
    utils: { acceptMutations, exportData: async () => [...confirmed.values()] },
    get: (key: string) => optimistic.get(key) ?? confirmed.get(key),
    has: (key: string) => optimistic.has(key) || confirmed.has(key),
    insert: (row: Row) => optimistic.set(row.id, row),
    update: () => {},
  } as unknown as LocalCollection<Row>;
  const drafts = new Set(drafted);
  const draftsCollection = { has: (key: string) => drafts.has(key) } as unknown as DraftsCollection;
  return { store, drafts: draftsCollection, confirmed, optimistic, acceptMutations };
}

const ok = (): ReturnType<GetCall<Dto>> =>
  Promise.resolve({ data: dto, response: new Response(null, { status: 200 }) });

const problem =
  (type: string, status: number): GetCall<Dto> =>
  async () => ({
    error: {
      type: `urn:vistoria:problem:${type}`,
      title: type,
      status,
      detail: type,
      traceId: "00-trace",
    },
    response: new Response(null, { status }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(expireSession).mockClear();
});

describe("fetchMissing", () => {
  it("200: grava na store confirmada a resposta com a version, sem as datas do servidor", async () => {
    const local = setup();
    const get = vi.fn<GetCall<Dto>>(ok);

    expect(await fetchMissing({ ...local, id, get, shape })).toBe("found");

    expect(get).toHaveBeenCalledWith({ path: { id } });
    expect(local.confirmed.get(id)).toEqual({ id, version: "AAAAAAAAB9M=", name: "Do servidor" });
  });

  it("registro na fila (camada otimista) ou num rascunho: nada é pedido", async () => {
    const get = vi.fn<GetCall<Dto>>(ok);

    const queued = setup({ queued: [{ id, version: null, name: "Meu" }] });
    expect(await fetchMissing({ ...queued, id, get, shape })).toBe("local");
    const drafted = setup({ drafted: [id] });
    expect(await fetchMissing({ ...drafted, id, get, shape })).toBe("local");

    expect(get).not.toHaveBeenCalled();
    expect(queued.acceptMutations).not.toHaveBeenCalled();
    expect(drafted.acceptMutations).not.toHaveBeenCalled();
  });

  it("uma escrita feita no aparelho durante o GET vence: a resposta é descartada", async () => {
    const local = setup();
    const get: GetCall<Dto> = async () => {
      local.optimistic.set(id, { id, version: null, name: "Meu" });
      return ok();
    };

    expect(await fetchMissing({ ...local, id, get, shape })).toBe("local");

    expect(local.acceptMutations).not.toHaveBeenCalled();
    expect(local.optimistic.get(id)?.name).toBe("Meu");
  });

  it("before roda com o registro lido, antes de gravá-lo (o pai antes do filho)", async () => {
    const local = setup();
    const order: string[] = [];
    local.acceptMutations.mockImplementation(async () => {
      order.push("filho");
    });

    await fetchMissing({
      ...local,
      id,
      get: ok,
      shape,
      before: async (row) => {
        order.push(`pai de ${row.name}`);
      },
    });

    expect(order).toEqual(["pai de Do servidor", "filho"]);
  });

  it("sem rede no navegador: offline, sem requisição", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const get = vi.fn<GetCall<Dto>>(ok);

    expect(await fetchMissing({ ...setup(), id, get, shape })).toBe("offline");
    expect(get).not.toHaveBeenCalled();
  });

  it("falha de rede (sem resposta): offline", async () => {
    const get: GetCall<Dto> = async () => ({ error: new TypeError("Failed to fetch") });

    expect(await fetchMissing({ ...setup(), id, get, shape })).toBe("offline");
  });

  it("404 not-found: não encontrado, e nada fica na store", async () => {
    const local = setup();

    expect(await fetchMissing({ ...local, id, get: problem("not-found", 404), shape })).toBe(
      "not-found",
    );
    expect(local.confirmed.size).toBe(0);
  });

  it("401 unauthorized: a sessão expira, como na outbox", async () => {
    expect(await fetchMissing({ ...setup(), id, get: problem("unauthorized", 401), shape })).toBe(
      "failed",
    );
    expect(expireSession).toHaveBeenCalledOnce();
  });

  it("500 internal e resposta fora do contrato: falha, para tentar de novo", async () => {
    expect(await fetchMissing({ ...setup(), id, get: problem("internal", 500), shape })).toBe(
      "failed",
    );
    const html: GetCall<Dto> = async () => ({
      error: "<html>502</html>",
      response: new Response(null, { status: 502 }),
    });
    expect(await fetchMissing({ ...setup(), id, get: html, shape })).toBe("failed");
    expect(expireSession).not.toHaveBeenCalled();
  });
});
