// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { expireSession } from "../auth/session";
import type { DraftRecord, DraftsCollection } from "./drafts";
import { type GetCall, fetchMissing, refetchById } from "./fetch";
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

const persisted = { isPersisted: { promise: Promise.resolve() } };

/** Os rascunhos em memória: `drafted` são recusados (pendência); `clean`, do formulário profundo, sem nada a enviar. */
function draftsOf(drafted: string[], clean: DraftRecord[] = []) {
  const rows = new Map<string, DraftRecord>(clean.map((draft) => [draft.id, draft]));
  for (const key of drafted) {
    rows.set(key, {
      id: key,
      entity: "row",
      data: { id: key, name: "Recusado" },
      status: "rejected",
      errors: {},
      updatedAt: "2026-10-29T10:00:00.000Z",
    });
  }
  const collection = {
    has: (key: string) => rows.has(key),
    get: (key: string) => rows.get(key),
    delete: (key: string) => {
      rows.delete(key);
      return persisted;
    },
    update: (key: string, change: (draft: DraftRecord) => void) => {
      const draft = structuredClone(rows.get(key)!);
      change(draft);
      rows.set(key, draft);
      return persisted;
    },
  } as unknown as DraftsCollection;
  return { collection, rows };
}

/** A store confirmada e a camada otimista por cima (o que está na fila), como na collection do TanStack DB. */
function setup({
  queued = [] as Row[],
  drafted = [] as string[],
  clean = [] as DraftRecord[],
  stored = [] as Row[],
} = {}) {
  const confirmed = new Map<string, Row>(stored.map((row) => [row.id, row]));
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
    // O que está na fila leva `$hasPendingWrites`, como a linha otimista do TanStack DB.
    get: (key: string) =>
      optimistic.has(key) ? { ...optimistic.get(key), $hasPendingWrites: true } : confirmed.get(key),
    has: (key: string) => optimistic.has(key) || confirmed.has(key),
    insert: (row: Row) => optimistic.set(row.id, row),
    update: () => {},
  } as unknown as LocalCollection<Row>;
  const drafts = draftsOf(drafted, clean);
  return { store, drafts: drafts.collection, draftRows: drafts.rows, confirmed, optimistic, acceptMutations };
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

  it("depois do primeiro pull completo (synced): não existe ou foi excluído, sem GET", async () => {
    const get = vi.fn<GetCall<Dto>>(ok);

    expect(await fetchMissing({ ...setup(), id, get, shape, synced: () => true })).toBe("not-found");

    expect(get).not.toHaveBeenCalled();
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

// A marca de um registro que o pull pulou (ADR 0041): o registro está no aparelho e é buscado de novo, a menos que tenha
// pendência.
describe("refetchById", () => {
  const stored: Row = { id, version: "AAAAAAAAB9I=", name: "Antigo" };

  it("o registro confirmado no aparelho é buscado de novo e atualizado", async () => {
    const local = setup({ stored: [stored] });

    expect(await refetchById({ ...local, id, get: ok, shape })).toBe("found");

    expect(local.confirmed.get(id)).toEqual({ id, version: "AAAAAAAAB9M=", name: "Do servidor" });
  });

  it("com pendência (na fila ou em rascunho): nada é pedido", async () => {
    const get = vi.fn<GetCall<Dto>>(ok);

    const queued = setup({ stored: [stored], queued: [{ ...stored, name: "Meu" }] });
    expect(await refetchById({ ...queued, id, get, shape })).toBe("local");
    const drafted = setup({ stored: [stored], drafted: [id] });
    expect(await refetchById({ ...drafted, id, get, shape })).toBe("local");

    expect(get).not.toHaveBeenCalled();
  });

  it("a pendência que volta durante o GET vence: a resposta é descartada, também no 404", async () => {
    const local = setup({ stored: [stored] });
    const answer =
      (response: GetCall<Dto>): GetCall<Dto> =>
      async (request) => {
        local.draftRows.set(id, draftsOf([id]).rows.get(id)!);
        return response(request);
      };

    expect(await refetchById({ ...local, id, get: answer(ok), shape })).toBe("local");
    local.draftRows.clear();
    expect(await refetchById({ ...local, id, get: answer(problem("not-found", 404)), shape })).toBe(
      "local",
    );

    expect(local.acceptMutations).not.toHaveBeenCalled();
    expect(local.confirmed.get(id)).toEqual(stored);
  });

  it("404 not-found: o registro sai da store", async () => {
    const local = setup({ stored: [stored] });

    expect(await refetchById({ ...local, id, get: problem("not-found", 404), shape })).toBe("not-found");

    expect(local.confirmed.size).toBe(0);
  });

  // ADR 0043: o rascunho do formulário profundo com os valores do registro não é pendência.
  const cleanDraft: DraftRecord = {
    id,
    entity: "row",
    data: { id, name: "Antigo" },
    status: "draft",
    step: 2,
    errors: {},
    updatedAt: "2026-10-29T10:00:00.000Z",
  };

  it("rascunho limpo: é buscado, e o rascunho passa à versão nova com o mesmo passo", async () => {
    const local = setup({ stored: [stored], clean: [cleanDraft] });

    expect(await refetchById({ ...local, id, get: ok, shape })).toBe("found");

    expect(local.confirmed.get(id)?.name).toBe("Do servidor");
    expect(local.draftRows.get(id)).toMatchObject({
      data: { id, name: "Do servidor" },
      status: "draft",
      step: 2,
      rebasedAt: expect.any(String),
    });
    expect(local.draftRows.get(id)?.data).not.toHaveProperty("version");
  });

  it("rascunho draft com valor diferente do registro: é pendência, nada é pedido", async () => {
    const get = vi.fn<GetCall<Dto>>(ok);
    const dirty = { ...cleanDraft, data: { id, name: "Marcado aqui" } };
    const local = setup({ stored: [stored], clean: [dirty] });

    expect(await refetchById({ ...local, id, get, shape })).toBe("local");

    expect(get).not.toHaveBeenCalled();
    expect(local.draftRows.get(id)).toEqual(dirty);
  });

  it("rascunho limpo e 404: o registro e o rascunho saem", async () => {
    const local = setup({ stored: [stored], clean: [cleanDraft] });

    expect(await refetchById({ ...local, id, get: problem("not-found", 404), shape })).toBe("not-found");

    expect(local.confirmed.size).toBe(0);
    expect(local.draftRows.size).toBe(0);
  });
});
