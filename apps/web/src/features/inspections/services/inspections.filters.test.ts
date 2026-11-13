// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { clock } from "@/shared/clock";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { PendingRecord } from "@/shared/sync/sync-view";

import type { InspectionRecord } from "../models/inspection";
import { type InspectionFilters, NO_FILTERS } from "../models/inspection-filters";
import { summaryOf } from "./inspections.summary";
import {
  LIST_PAGE_SIZE,
  type PlaceView,
  inspectionPage,
  periodStart,
  propertyOptionsOf,
} from "./inspections.view";

// A busca e os filtros da lista (#175), sobre o resumo de cada vistoria e a fila por cima (ADR 0048): cada filtro,
// a combinação e a paginação de 50 sobre o resultado filtrado.

/** "Hoje": 13/11/2026, 15:00, no fuso de quem roda o teste. */
const NOW = new Date(2026, 10, 13, 15, 0);
/** Uma data local, em ISO, como o `startedAt` vem. */
const at = (year: number, month: number, day: number, hour = 9) =>
  new Date(year, month - 1, day, hour).toISOString();

const inspection = (id: string, over: Partial<InspectionRecord> = {}): InspectionRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  propertyId: "flores",
  kind: "moveIn",
  status: "inProgress",
  startedAt: at(2026, 11, 10),
  generalNotes: null,
  rooms: [],
  ...over,
});

const places = new Map<string, PlaceView>([
  [
    "flores",
    {
      address: "Rua das Flores, 120 · ap 32",
      clientName: "Imobiliária Horizonte",
      clientId: "horizonte",
    },
  ],
  [
    "augusta",
    { address: "Rua Augusta, 88", clientName: "Imobiliária Horizonte", clientId: "horizonte" },
  ],
  ["brasil", { address: "Av. Brasil, 1500 · sala 4", clientName: "Lar Imóveis", clientId: "lar" }],
  [
    "sao-joao",
    { address: "Av. São João, 900", clientName: "Conceição Araújo", clientId: "conceicao" },
  ],
]);

/** As vistorias confirmadas do aparelho, uma de cada jeito. */
const ALL = [
  inspection("flores-entrada"),
  inspection("flores-saida", { kind: "moveOut", status: "completed", startedAt: at(2026, 11, 12) }),
  inspection("augusta-entrada", {
    propertyId: "augusta",
    status: "completed",
    startedAt: at(2026, 10, 1),
  }),
  inspection("brasil-saida", { propertyId: "brasil", kind: "moveOut", startedAt: at(2026, 2, 3) }),
  inspection("sao-joao-entrada", { propertyId: "sao-joao", startedAt: at(2025, 11, 13) }),
  inspection("fora", { propertyId: "fora-do-aparelho", startedAt: at(2026, 11, 13) }),
];

const NONE = new Map<string, PendingRecord>();

const queued = (
  record: InspectionRecord,
  over: Partial<PendingRecord> = {},
): [string, PendingRecord] => [
  record.id,
  { mutationFnName: "upsertInspection", record, removed: false, ...over },
];

const rejected = (record: InspectionRecord): DraftRecord => ({
  id: record.id,
  entity: "inspection",
  data: record,
  status: "rejected",
  errors: { propertyId: ["Imóvel não encontrado."] },
  updatedAt: at(2026, 11, 13),
});

function ids(
  filters: Partial<InspectionFilters>,
  {
    summaries = ALL,
    pending = NONE,
    drafts = [],
  }: {
    summaries?: InspectionRecord[];
    pending?: ReadonlyMap<string, PendingRecord>;
    drafts?: DraftRecord[];
  } = {},
): string[] {
  const page = inspectionPage(
    summaries.map(summaryOf),
    pending,
    drafts,
    new Map(),
    places,
    Infinity,
    {
      ...NO_FILTERS,
      ...filters,
    },
  );
  return page.rows.map((row) => row.id).toSorted();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cada filtro, sobre o resumo", () => {
  it("sem filtro, todas", () => {
    expect(ids({})).toHaveLength(ALL.length);
  });

  it("busca pelo endereço, sem acento e sem caixa", () => {
    expect(ids({ query: "rua das flores" })).toEqual(["flores-entrada", "flores-saida"]);
    expect(ids({ query: "  SAO JOÃO " })).toEqual(["sao-joao-entrada"]);
    expect(ids({ query: "1500" })).toEqual(["brasil-saida"]);
  });

  it("busca pelo nome do cliente, sem acento", () => {
    expect(ids({ query: "horizonte" })).toEqual([
      "augusta-entrada",
      "flores-entrada",
      "flores-saida",
    ]);
    expect(ids({ query: "conceicao araujo" })).toEqual(["sao-joao-entrada"]);
  });

  it("busca sem nada que case, e a vistoria de imóvel fora do aparelho nunca casa com a busca", () => {
    expect(ids({ query: "Peixoto" })).toEqual([]);
    expect(ids({ query: "a" })).not.toContain("fora");
  });

  it("cliente: as vistorias dos imóveis dele", () => {
    expect(ids({ clientId: "horizonte" })).toEqual([
      "augusta-entrada",
      "flores-entrada",
      "flores-saida",
    ]);
    expect(ids({ clientId: "lar" })).toEqual(["brasil-saida"]);
  });

  it("imóvel", () => {
    expect(ids({ propertyId: "flores" })).toEqual(["flores-entrada", "flores-saida"]);
    expect(ids({ propertyId: "fora-do-aparelho" })).toEqual(["fora"]);
  });

  it("tipo", () => {
    expect(ids({ kind: "moveOut" })).toEqual(["brasil-saida", "flores-saida"]);
    expect(ids({ kind: "moveIn" })).toHaveLength(4);
  });

  it("status", () => {
    expect(ids({ status: "completed" })).toEqual(["augusta-entrada", "flores-saida"]);
    expect(ids({ status: "inProgress" })).toHaveLength(4);
  });

  it("período: últimos 7 dias, 30 dias e 12 meses, contando hoje, pela data de início", () => {
    vi.spyOn(clock, "now").mockReturnValue(NOW);
    expect(ids({ period: "7d" })).toEqual(["flores-entrada", "flores-saida", "fora"]);
    expect(ids({ period: "30d" })).toEqual(["flores-entrada", "flores-saida", "fora"]);
    expect(ids({ period: "12m" })).toEqual([
      "augusta-entrada",
      "brasil-saida",
      "flores-entrada",
      "flores-saida",
      "fora",
    ]);
  });

  it("período: o primeiro dia entra desde a meia-noite local, e o dia antes dele não", () => {
    const edge = (startedAt: string) => inspection("borda", { startedAt });
    const run = (startedAt: string, period: "7d" | "30d" | "12m") =>
      ids({ period }, { summaries: [edge(startedAt)] });
    vi.spyOn(clock, "now").mockReturnValue(NOW);

    expect(run(new Date(2026, 10, 7, 0, 0).toISOString(), "7d")).toEqual(["borda"]);
    expect(run(new Date(2026, 10, 6, 23, 59).toISOString(), "7d")).toEqual([]);
    expect(run(new Date(2026, 9, 15, 0, 0).toISOString(), "30d")).toEqual(["borda"]);
    expect(run(new Date(2026, 9, 14, 23, 59).toISOString(), "30d")).toEqual([]);
    expect(run(new Date(2025, 10, 14, 0, 0).toISOString(), "12m")).toEqual(["borda"]);
    expect(run(new Date(2025, 10, 13, 23, 59).toISOString(), "12m")).toEqual([]);
  });

  it("periodStart: a meia-noite local do primeiro dia do período", () => {
    expect(periodStart("7d", NOW)).toEqual(new Date(2026, 10, 7));
    expect(periodStart("30d", NOW)).toEqual(new Date(2026, 9, 15));
    expect(periodStart("12m", NOW)).toEqual(new Date(2025, 10, 14));
  });
});

describe("a combinação", () => {
  it("todos os filtros juntos só deixam o que casa com cada um", () => {
    vi.spyOn(clock, "now").mockReturnValue(NOW);
    expect(
      ids({
        query: "flores",
        clientId: "horizonte",
        propertyId: "flores",
        kind: "moveOut",
        status: "completed",
        period: "7d",
      }),
    ).toEqual(["flores-saida"]);
    expect(ids({ clientId: "horizonte", kind: "moveIn" })).toEqual([
      "augusta-entrada",
      "flores-entrada",
    ]);
    expect(ids({ clientId: "lar", status: "completed" })).toEqual([]);
    expect(ids({ query: "horizonte", period: "30d" })).toEqual(["flores-entrada", "flores-saida"]);
  });
});

describe("sobre a fila (ADR 0048)", () => {
  it("a criada só na fila entra quando casa, e fica fora quando não casa", () => {
    const created = inspection("nova", { propertyId: "brasil", kind: "moveIn" });
    const pending = new Map([queued(created)]);

    expect(ids({ clientId: "lar" }, { pending })).toEqual(["brasil-saida", "nova"]);
    expect(ids({ kind: "moveIn", clientId: "lar" }, { pending })).toEqual(["nova"]);
    expect(ids({ kind: "moveOut", clientId: "lar" }, { pending })).toEqual(["brasil-saida"]);
  });

  it("a fila vence o resumo: a concluída na fila sai de 'Em andamento' e entra em 'Concluída'", () => {
    const completing = inspection("flores-entrada", { status: "completed" });
    const pending = new Map([queued(completing)]);

    expect(ids({ status: "inProgress", propertyId: "flores" }, { pending })).toEqual([]);
    expect(ids({ status: "completed", propertyId: "flores" }, { pending })).toEqual([
      "flores-entrada",
      "flores-saida",
    ]);
  });

  it("a fila muda o imóvel: a vistoria sai do filtro do imóvel antigo e entra no do novo", () => {
    const moved = inspection("flores-entrada", { propertyId: "augusta" });
    const pending = new Map([queued(moved)]);

    expect(ids({ propertyId: "flores" }, { pending })).toEqual(["flores-saida"]);
    expect(ids({ query: "augusta" }, { pending })).toEqual(["augusta-entrada", "flores-entrada"]);
  });

  it("com a exclusão na fila, a linha segue na lista filtrada, como 'Excluindo', enquanto casa", () => {
    const deleting = inspection("brasil-saida", {
      propertyId: "brasil",
      kind: "moveOut",
      startedAt: at(2026, 2, 3),
      deleting: true,
    });
    const pending = new Map([queued(deleting, { mutationFnName: "deleteInspection" })]);
    const page = inspectionPage(ALL.map(summaryOf), pending, [], new Map(), places, Infinity, {
      ...NO_FILTERS,
      clientId: "lar",
    });

    expect(page.rows.map((row) => [row.id, row.sync])).toEqual([["brasil-saida", "excluindo"]]);
  });

  it("o rascunho recusado filtra pelos dados dele, não pelo resumo", () => {
    const sent = inspection("flores-entrada", { kind: "moveOut" });
    const drafts = [rejected(sent)];

    expect(ids({ kind: "moveOut", propertyId: "flores" }, { drafts })).toEqual([
      "flores-entrada",
      "flores-saida",
    ]);
    expect(ids({ kind: "moveIn", propertyId: "flores" }, { drafts })).toEqual([]);
  });

  it("o rascunho recusado que só existe nele entra quando casa", () => {
    const drafts = [rejected(inspection("so-rascunho", { propertyId: "sao-joao" }))];

    expect(ids({ query: "são joão" }, { drafts })).toEqual(["sao-joao-entrada", "so-rascunho"]);
  });
});

describe("paginação sobre o filtro", () => {
  it("50 por vez sobre o resultado filtrado; o total é o filtrado e o `all`, o do aparelho", () => {
    const many = Array.from({ length: 120 }, (_, n) =>
      inspection(`i${n}`, {
        propertyId: n % 2 === 0 ? "flores" : "brasil",
        startedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
      }),
    );
    const page = (limit: number) =>
      inspectionPage(many.map(summaryOf), NONE, [], new Map(), places, limit, {
        ...NO_FILTERS,
        clientId: "lar",
      });

    const first = page(LIST_PAGE_SIZE);
    expect(first.rows).toHaveLength(50);
    expect(first.total).toBe(60);
    expect(first.all).toBe(120);
    expect(first.rows.every((row) => row.propertyId === "brasil")).toBe(true);
    // A mais recente primeiro, como sem filtro.
    expect(first.rows[0]!.id).toBe("i119");

    const second = page(LIST_PAGE_SIZE * 2);
    expect(second.rows).toHaveLength(60);
    expect(second.rows.slice(0, 50)).toEqual(first.rows);
  });
});

describe("propertyOptionsOf", () => {
  it("os imóveis pelo endereço; com um cliente, só os dele", () => {
    expect(propertyOptionsOf(places, null).map((option) => option.label)).toEqual([
      "Av. Brasil, 1500 · sala 4",
      "Av. São João, 900",
      "Rua Augusta, 88",
      "Rua das Flores, 120 · ap 32",
    ]);
    expect(propertyOptionsOf(places, "horizonte")).toEqual([
      { value: "augusta", label: "Rua Augusta, 88" },
      { value: "flores", label: "Rua das Flores, 120 · ap 32" },
    ]);
  });
});
