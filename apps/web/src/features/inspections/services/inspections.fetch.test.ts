// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { ClientsCollection } from "@/features/clients/services/clients.collection";
import { fetchClient } from "@/features/clients/services/clients.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import type { PropertiesCollection } from "@/features/properties/services/properties.collection";
import { fetchProperty } from "@/features/properties/services/properties.sync";
import { configureClient } from "@/shared/api/client";
import { createClient, createConfig } from "@/shared/api/generated/client";
import type { DraftsCollection } from "@/shared/sync/drafts";
import type { CursorsCollection } from "@/shared/sync/pull";

import type { InspectionRecord } from "../models/inspection";
import type { InspectionsCollection } from "./inspections.collection";
import { newMoveInInspection } from "./inspections.factory";
import { fetchInspection } from "./inspections.sync";

// A leitura por id dos três recursos contra um servidor falso, que responde o `GET` pela rota: o registro local que
// cada DTO vira, a vistoria que traz o imóvel e o cliente que faltam (gravados do pai para o filho) e o 404. O caminho
// comum (pendência, rede, sessão) tem os testes em `shared/sync/fetch.test.ts`.

const dates = { createdAt: "2026-10-29T12:00:00Z", updatedAt: "2026-10-29T12:00:00Z" };

const lar: ClientRecord = {
  id: "01a16032-2dfb-77de-84a2-1f165bdd9901",
  version: "AAAAAAAAB9M=",
  name: "Imobiliária Lar",
  document: "52998224725",
  email: null,
  phone: null,
};

const apto: PropertyRecord = {
  id: "01a16032-2dfb-77de-84a2-1f165bdd9902",
  version: "AAAAAAAAB9N=",
  clientId: lar.id,
  street: "R. das Flores",
  number: "120",
  complement: "Apto 302",
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: null,
};

const vistoria: InspectionRecord = {
  ...newMoveInInspection(apto.id),
  id: "01a16032-2dfb-77de-84a2-1f165bdd9903",
  version: "AAAAAAAAB9O=",
};

const inspectionDto = {
  ...vistoria,
  referenceInspectionId: null,
  completedAt: null,
  rooms: vistoria.rooms.map((room) => ({
    ...room,
    items: room.items.map((item) => ({ ...item, referenceCondition: null, referenceNotes: null })),
  })),
  ...dates,
};

const notFound = () =>
  Response.json(
    {
      type: "urn:vistoria:problem:not-found",
      title: "",
      status: 404,
      detail: "",
      traceId: "00-trace",
    },
    { status: 404, headers: { "content-type": "application/problem+json" } },
  );

/** Uma collection em memória; `writes` guarda a ordem em que a store confirmada recebeu cada registro. */
function collection<T extends { id: string }>(name: string, writes: string[], stored: T[] = []) {
  const confirmed = new Map(stored.map((row) => [row.id, row]));
  return {
    confirmed,
    collection: {
      utils: {
        exportData: async () => [...confirmed.values()],
        readConfirmed: async (ids: readonly string[]) => ids.flatMap((key) => confirmed.get(key) ?? []),
        acceptMutations: async ({ mutations }: { mutations: { modified: T }[] }) => {
          for (const { modified } of mutations) {
            confirmed.set(modified.id, modified);
            writes.push(name);
          }
        },
      },
      get: (key: string) => confirmed.get(key),
      has: (key: string) => confirmed.has(key),
    },
  };
}

function setup(
  server: Record<string, unknown>,
  {
    clients = [] as ClientRecord[],
    properties = [] as PropertyRecord[],
    pulled = [] as string[],
  } = {},
) {
  const requests: string[] = [];
  const client = configureClient(createClient(createConfig()), {
    baseUrl: "http://api.test",
    token: { get: () => "t0k3n" },
    fetch: async (input) => {
      const path = new URL((input as Request).url).pathname;
      requests.push(path);
      return path in server ? Response.json(server[path]) : notFound();
    },
  });
  const writes: string[] = [];
  const c = collection<ClientRecord>("cliente", writes, clients);
  const p = collection<PropertyRecord>("imóvel", writes, properties);
  const i = collection<InspectionRecord>("vistoria", writes, []);
  const store = {
    clients: c.collection as unknown as ClientsCollection,
    properties: p.collection as unknown as PropertiesCollection,
    inspections: i.collection as unknown as InspectionsCollection,
    drafts: { has: () => false } as unknown as DraftsCollection,
    // `pulled`: os laços que já chegaram ao fim uma vez (ADR 0043).
    cursors: {
      get: (entity: string) => (pulled.includes(entity) ? { id: entity, complete: true } : undefined),
    } as unknown as CursorsCollection,
  };
  return {
    store,
    client,
    requests,
    writes,
    clients: c.confirmed,
    properties: p.confirmed,
    inspections: i.confirmed,
  };
}

const routes = {
  [`/api/v1/clients/${lar.id}`]: { ...lar, ...dates },
  [`/api/v1/properties/${apto.id}`]: { ...apto, ...dates },
  [`/api/v1/inspections/${vistoria.id}`]: inspectionDto,
};

describe("fetchInspection", () => {
  it("contexto novo: a vistoria traz o imóvel e o cliente, gravados do pai para o filho, com a version", async () => {
    const local = setup(routes);

    expect(await fetchInspection(local.store, vistoria.id, local.client)).toBe("found");

    expect(local.requests).toEqual([
      `/api/v1/inspections/${vistoria.id}`,
      `/api/v1/properties/${apto.id}`,
      `/api/v1/clients/${lar.id}`,
    ]);
    expect(local.writes).toEqual(["cliente", "imóvel", "vistoria"]);
    expect(local.clients.get(lar.id)).toEqual(lar);
    expect(local.properties.get(apto.id)).toEqual(apto);
    expect(local.inspections.get(vistoria.id)).toEqual(vistoria);
  });

  it("imóvel e cliente que já estão no aparelho não são pedidos de novo", async () => {
    const local = setup(routes, { clients: [lar], properties: [apto] });

    await fetchInspection(local.store, vistoria.id, local.client);

    expect(local.requests).toEqual([`/api/v1/inspections/${vistoria.id}`]);
    expect(local.writes).toEqual(["vistoria"]);
  });

  it("o imóvel que falha não segura a vistoria", async () => {
    const { [`/api/v1/properties/${apto.id}`]: _property, ...withoutProperty } = routes;
    const local = setup(withoutProperty);

    expect(await fetchInspection(local.store, vistoria.id, local.client)).toBe("found");
    expect(local.writes).toEqual(["vistoria"]);
  });

  it("depois do primeiro pull de vistorias: não existe ou foi excluída, sem GET", async () => {
    const local = setup(routes, { pulled: ["inspections"] });

    expect(await fetchInspection(local.store, vistoria.id, local.client)).toBe("not-found");

    expect(local.requests).toEqual([]);
    expect(local.writes).toEqual([]);
  });

  it("antes do primeiro pull de vistorias, mas depois do de imóveis e clientes: só a vistoria é pedida", async () => {
    const local = setup(routes, { pulled: ["clients", "properties"] });

    expect(await fetchInspection(local.store, vistoria.id, local.client)).toBe("found");

    expect(local.requests).toEqual([`/api/v1/inspections/${vistoria.id}`]);
    expect(local.writes).toEqual(["vistoria"]);
  });

  it("404: não encontrada, e nada é gravado", async () => {
    const local = setup({});

    expect(await fetchInspection(local.store, vistoria.id, local.client)).toBe("not-found");
    expect(local.requests).toEqual([`/api/v1/inspections/${vistoria.id}`]);
    expect(local.writes).toEqual([]);
  });
});

describe("fetchProperty", () => {
  it("traz o cliente que falta antes de gravar o imóvel, sem as datas do servidor", async () => {
    const local = setup(routes);

    expect(await fetchProperty(local.store, apto.id, local.client)).toBe("found");

    expect(local.writes).toEqual(["cliente", "imóvel"]);
    expect(local.properties.get(apto.id)).toEqual(apto);
  });

  it("404: não encontrado", async () => {
    const local = setup({});

    expect(await fetchProperty(local.store, apto.id, local.client)).toBe("not-found");
    expect(local.writes).toEqual([]);
  });
});

describe("fetchClient", () => {
  it("grava o cliente com a version, sem as datas do servidor", async () => {
    const local = setup(routes);

    expect(await fetchClient(local.store, lar.id, local.client)).toBe("found");

    expect(local.requests).toEqual([`/api/v1/clients/${lar.id}`]);
    expect(local.clients.get(lar.id)).toEqual(lar);
  });

  it("404: não encontrado", async () => {
    const local = setup({});

    expect(await fetchClient(local.store, lar.id, local.client)).toBe("not-found");
    expect(local.writes).toEqual([]);
  });
});
