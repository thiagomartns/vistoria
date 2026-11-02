// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { DraftRecord } from "@/shared/sync/drafts";
import type { PendingRecord } from "@/shared/sync/sync-view";

import type { InspectionRecord } from "../models/inspection";
import {
  LIST_PAGE_SIZE,
  countLabel,
  dateOf,
  deletionSubject,
  fieldHeader,
  hasUnsent,
  inspectionRowOf,
  inspectionPage,
  inspectionRows,
  isDeletable,
  pendingItemIds,
  roomViews,
  roomsSummary,
  startedLabel,
} from "./inspections.view";
import { summaryOf } from "./inspections.summary";

const inspection = (id: string, over: Partial<InspectionRecord> = {}): InspectionRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: "2026-10-26T13:00:00.000Z",
  generalNotes: null,
  rooms: [
    {
      id: `${id}-r1`,
      name: "Sala",
      position: 0,
      notes: null,
      items: [
        { id: `${id}-t1`, name: "Piso", position: 0, condition: "good", notes: null },
        { id: `${id}-t2`, name: "Paredes", position: 1, condition: null, notes: null },
      ],
    },
  ],
  ...over,
});

const rejected = (record: InspectionRecord): DraftRecord => ({
  id: record.id,
  entity: "inspection",
  data: record,
  status: "rejected",
  errors: { propertyId: ["Imóvel não encontrado."] },
  updatedAt: "2026-10-26T13:10:00.000Z",
});

/** Nada na fila. */
const NONE = new Map<string, PendingRecord>();

const queued = (record: InspectionRecord, over: Partial<PendingRecord> = {}): [string, PendingRecord] => [
  record.id,
  { mutationFnName: "upsertInspection", record, removed: false, ...over },
];

const addresses = new Map([
  ["p1", { address: "Rua das Flores, 120 · ap 32", clientName: "Imobiliária Horizonte" }],
]);

describe("inspectionRowOf", () => {
  it("endereço do imóvel, tipo, itens avaliados e sincronizada sem transação na fila", () => {
    expect(inspectionRowOf(inspection("i1"), undefined, undefined, addresses)).toEqual({
      id: "i1",
      propertyId: "p1",
      address: "Rua das Flores, 120 · ap 32",
      clientName: "Imobiliária Horizonte",
      kindLabel: "Entrada",
      status: "inProgress",
      statusLabel: "Em andamento",
      startedAt: "2026-10-26T13:00:00.000Z",
      evaluated: 1,
      items: 2,
      sync: "sincronizado",
    });
  });

  it("com transação na fila, o estado dela; imóvel fora do aparelho, sem endereço", () => {
    expect(
      inspectionRowOf(inspection("i1", { propertyId: "p9" }), undefined, "local", addresses),
    ).toMatchObject({
      address: null,
      sync: "local",
    });
  });

  it("o rascunho recusado vence: mostra o que foi enviado, como rejeitado", () => {
    const sent = inspection("i1", { kind: "moveOut" });

    expect(inspectionRowOf(inspection("i1"), rejected(sent), "local", addresses)).toMatchObject({
      kindLabel: "Saída",
      sync: "rejeitado",
    });
  });
});

describe("exclusão", () => {
  it("com a exclusão na fila, a linha fica 'Excluindo', mesmo com o envio no ar", () => {
    expect(
      inspectionRowOf(inspection("i1", { deleting: true }), undefined, "enviando", addresses)?.sync,
    ).toBe("excluindo");
  });

  it("só a em andamento pode ser excluída, e só uma vez", () => {
    expect(isDeletable({ status: "inProgress", sync: "sincronizado" })).toBe(true);
    expect(isDeletable({ status: "inProgress", sync: "conflito" })).toBe(true);
    expect(isDeletable({ status: "completed", sync: "sincronizado" })).toBe(false);
    expect(isDeletable({ status: "inProgress", sync: "excluindo" })).toBe(false);
  });

  it("alteração não enviada: na fila, recusada ou em conflito", () => {
    expect(
      ["local", "enviando", "conflito", "rejeitado"].every((sync) => hasUnsent(sync as never)),
    ).toBe(true);
    expect(hasUnsent("sincronizado")).toBe(false);
    expect(hasUnsent("excluindo")).toBe(false);
    expect(hasUnsent(undefined)).toBe(false);
  });

  it("o Dialog nomeia o endereço e o tipo", () => {
    expect(deletionSubject("Rua das Flores, 120 · ap 32", "Entrada")).toBe(
      "Rua das Flores, 120 · ap 32 · Vistoria de entrada",
    );
    expect(deletionSubject("Rua das Flores, 120 · ap 32", null)).toBe(
      "Rua das Flores, 120 · ap 32",
    );
  });
});

describe("inspectionRows", () => {
  it("o rascunho que só guarda o passo da tela de campo não muda a linha", () => {
    const draft: DraftRecord = {
      ...rejected(inspection("i1", { kind: "moveOut" })),
      status: "draft",
      errors: {},
      step: 2,
    };

    expect(
      inspectionRows(
        [summaryOf(inspection("i1"))],
        NONE,
        [draft],
        new Map([["i1", "local"]]),
        addresses,
      ),
    ).toMatchObject([{ id: "i1", kindLabel: "Entrada", sync: "local" }]);
  });

  it("em andamento primeiro, depois a mais recente (nota do wireframe)", () => {
    const done = inspection("i1", { status: "completed", startedAt: "2026-10-26T12:00:00.000Z" });
    const open = inspection("i2", { startedAt: "2026-10-20T09:00:00.000Z" });

    expect(
      inspectionRows([done, open].map(summaryOf), NONE, [], new Map(), addresses).map((row) => [
        row.id,
        row.statusLabel,
      ]),
    ).toEqual([
      ["i2", "Em andamento"],
      ["i1", "Concluída"],
    ]);
  });

  it("vistorias e rascunhos de vistoria (só os de vistoria), da mais recente para a mais antiga", () => {
    const older = inspection("i1", { startedAt: "2026-10-25T09:00:00.000Z" });
    const newer = inspection("i2", { startedAt: "2026-10-26T09:00:00.000Z" });
    const onlyDraft = inspection("i3", { startedAt: "2026-10-26T12:00:00.000Z" });
    const otherEntity: DraftRecord = { ...rejected(inspection("x1")), entity: "property" };

    const rows = inspectionRows(
      [older, newer].map(summaryOf),
      NONE,
      [rejected(onlyDraft), otherEntity],
      new Map(),
      addresses,
    );

    expect(rows.map((row) => [row.id, row.sync])).toEqual([
      ["i3", "rejeitado"],
      ["i2", "sincronizado"],
      ["i1", "sincronizado"],
    ]);
  });
});

describe("inspectionRows pelo resumo e pela fila (ADR 0048)", () => {
  it("a linha do resumo conta os itens avaliados como a da vistoria completa", () => {
    const full = inspection("i1");

    expect(inspectionRows([summaryOf(full)], NONE, [], new Map(), addresses)).toEqual([
      inspectionRowOf(full, undefined, undefined, addresses),
    ]);
    expect(summaryOf(full)).toMatchObject({ evaluated: 1, items: 2 });
  });

  it("a fila vence o resumo: a criada no aparelho aparece, e a alterada mostra o que a fila tem", () => {
    const created = inspection("i2", { version: null, startedAt: "2026-10-27T09:00:00.000Z" });
    const changed = inspection("i1", { kind: "moveOut" });

    const rows = inspectionRows(
      [summaryOf(inspection("i1"))],
      new Map([queued(created), queued(changed)]),
      [],
      new Map([
        ["i1", "local"],
        ["i2", "enviando"],
      ]),
      addresses,
    );

    expect(rows.map((row) => [row.id, row.kindLabel, row.sync])).toEqual([
      ["i2", "Entrada", "enviando"],
      ["i1", "Saída", "local"],
    ]);
  });

  it("a exclusão na fila deixa a linha \"Excluindo\", e a da criada no aparelho a tira da lista", () => {
    const leaving = inspection("i1", { deleting: true });
    const created = inspection("i2", { version: null });

    const rows = inspectionRows(
      [summaryOf(inspection("i1"))],
      new Map([
        queued(leaving, { mutationFnName: "deleteInspection" }),
        queued(created, { mutationFnName: "deleteInspection", removed: true }),
      ]),
      [],
      new Map([
        ["i1", "local"],
        ["i2", "local"],
      ]),
      addresses,
    );

    expect(rows.map((row) => [row.id, row.sync])).toEqual([["i1", "excluindo"]]);
  });

  it("o rascunho recusado vence o resumo e a fila", () => {
    const sent = inspection("i1", { kind: "moveOut" });

    const rows = inspectionRows(
      [summaryOf(inspection("i1"))],
      new Map([queued(sent)]),
      [rejected(sent)],
      new Map([["i1", "local"]]),
      addresses,
    );

    expect(rows.map((row) => [row.id, row.kindLabel, row.sync])).toEqual([
      ["i1", "Saída", "rejeitado"],
    ]);
  });
});

describe("lista longa (spike 2, ADR 0047)", () => {
  it("o contador diz o total, e quantas a lista montou quando ela está cortada", () => {
    expect(countLabel(1, 1)).toBe("1 vistoria");
    expect(countLabel(6, 6)).toBe("6 vistorias");
    expect(countLabel(LIST_PAGE_SIZE, 10_000)).toBe("50 de 10.000 vistorias");
    expect(countLabel(1_050, 10_000)).toBe("1.050 de 10.000 vistorias");
  });

  it("10 mil vistorias: em andamento primeiro e a mais recente antes, pela data do início", () => {
    const records = Array.from({ length: 10_000 }, (_, n) =>
      inspection(`i${n}`, {
        status: n % 10 < 4 ? "completed" : "inProgress",
        startedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
      }),
    );

    const rows = inspectionRows(records.map(summaryOf), NONE, [], new Map(), addresses);

    expect(rows).toHaveLength(10_000);
    const firstDone = rows.findIndex((row) => row.status === "completed");
    expect(firstDone).toBe(6_000);
    for (const part of [rows.slice(0, firstDone), rows.slice(firstDone)]) {
      const dates = part.map((row) => row.startedAt);
      expect(dates).toEqual(dates.toSorted().toReversed());
    }
  });

  it("a página monta só as linhas dela, na ordem da lista inteira, e diz o total (ADR 0048)", () => {
    const records = Array.from({ length: 300 }, (_, n) =>
      inspection(`i${n}`, {
        status: n % 3 === 0 ? "completed" : "inProgress",
        startedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
      }),
    );
    const onlyDraft = rejected(inspection("d1", { startedAt: "2027-01-01T00:00:00.000Z" }));
    const args = [records.map(summaryOf), NONE, [onlyDraft], new Map(), addresses] as const;

    const page = inspectionPage(...args, LIST_PAGE_SIZE);

    expect(page.total).toBe(301);
    expect(page.rows).toEqual(inspectionRows(...args).slice(0, LIST_PAGE_SIZE));
    expect(page.rows[0]).toMatchObject({ id: "d1", sync: "rejeitado" });
  });

  it("as datas saem como o toLocaleDateString e o toLocaleTimeString de pt-BR", () => {
    for (const iso of ["2026-10-19T12:12:00.000Z", "2026-01-05T23:59:00.000Z", "2026-12-31T00:01:00.000Z"]) {
      const date = new Date(iso);
      const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      expect(dateOf(iso)).toBe(date.toLocaleDateString("pt-BR"));
      expect(startedLabel(iso)).toBe(`Iniciada em ${day}, ${time}`);
    }
    expect(dateOf("não é data")).toBe("");
  });
});

describe("tela de campo", () => {
  const rooms = [
    {
      id: "r1",
      name: "Sala",
      items: [
        { id: "a", condition: "good" as const },
        { id: "b", condition: "new" as const },
      ],
    },
    {
      id: "r2",
      name: "Cozinha",
      items: [
        { id: "c", condition: null },
        { id: "d", condition: "poor" as const },
      ],
    },
    { id: "r3", name: "Varanda", items: [] },
  ];

  it("etapas: completa, pendente e vazia, com o progresso do cabeçalho do ambiente", () => {
    const views = roomViews(rooms);

    expect(views.map((room) => [room.name, room.state, room.meta, room.progress])).toEqual([
      ["Sala", "completa", "2 de 2", "2 de 2 itens avaliados"],
      ["Cozinha", "pendente", "1 de 2", "1 de 2 itens avaliados"],
      ["Varanda", "pendente", "0 itens", "Nenhum item ainda"],
    ]);
    expect(roomsSummary(views)).toBe("1 de 3 concluídos");
  });

  it("erros do servidor marcam a etapa do ambiente, com a contagem", () => {
    const views = roomViews(rooms, {
      "rooms[1].items[0].condition": ["Escolha a condição."],
      "rooms[1].items[1].notes": ["Longa."],
      propertyId: ["Imóvel não encontrado."],
    });

    expect(views[1]).toMatchObject({ state: "erro", meta: "2 erros", errors: 2 });
    expect(views[0]).toMatchObject({ state: "completa", errors: 0 });
  });

  it("itens não enviados: os que diferem da base; numa criação, os que já têm algo", () => {
    const current = {
      rooms: [
        {
          items: [
            { id: "a", condition: "good", notes: null },
            { id: "b", condition: "fair", notes: "Mancha" },
            { id: "c", condition: null, notes: null },
          ],
        },
      ],
    } as never;
    const base = {
      rooms: [
        {
          items: [
            { id: "a", condition: "good", notes: null },
            { id: "b", condition: "fair", notes: null },
            { id: "c", condition: null, notes: null },
          ],
        },
      ],
    };

    expect([...pendingItemIds(current, base)]).toEqual(["b"]);
    expect([...pendingItemIds(current, undefined)]).toEqual(["a", "b"]);
  });

  it("cabeçalho: endereço, tipo, cliente e início; no celular, só o tipo", () => {
    const startedAt = new Date(2026, 9, 19, 9, 12).toISOString();

    expect(
      fieldHeader(
        { kind: "moveIn", startedAt },
        { address: "Apto 302 · R. das Flores, 120", clientName: "Imobiliária Lar" },
      ),
    ).toEqual({
      title: "Apto 302 · R. das Flores, 120",
      subtitle: "Vistoria de entrada · Imobiliária Lar · iniciada em 19/10 às 09:12",
      compactSubtitle: "Vistoria de entrada",
    });
    expect(fieldHeader({ kind: "moveIn", startedAt }, undefined).title).toBe("Vistoria");
    expect(startedLabel(startedAt)).toBe("Iniciada em 19/10, 09:12");
  });
});
