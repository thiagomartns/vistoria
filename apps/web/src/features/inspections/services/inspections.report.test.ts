// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";

import type { InspectionRecord } from "../models/inspection";
import { REPORT_NOTICES, reportView } from "./inspections.report";

// O laudo de /inspections/report (Figma 177:16524): a folha só da conclusão que o servidor confirmou, e o aviso no
// lugar dela em andamento, com a conclusão na fila ou sem a vistoria no aparelho.

const horizonte: ClientRecord = {
  id: "c1",
  version: "AAAAAAAAB9M=",
  name: "Imobiliária Horizonte",
  document: "12345678000190",
  email: null,
  phone: null,
};

const apto: PropertyRecord = {
  id: "p1",
  version: "AAAAAAAAB9N=",
  clientId: "c1",
  street: "Rua das Flores",
  number: "120",
  complement: "ap 32",
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: null,
};

const startedAt = new Date(2026, 9, 19, 9, 12).toISOString();
const completedAt = new Date(2026, 9, 19, 11, 47).toISOString();

const entrada: InspectionRecord = {
  id: "0192f3a1-7c4e-7b2a-9d10-3e5f6a7b8c9d",
  version: "AAAAAAAAB9E=",
  propertyId: "p1",
  kind: "moveIn",
  status: "completed",
  startedAt,
  completedAt,
  completedBy: { id: "u1", name: "Thiago Martins" },
  generalNotes: "Imóvel entregue limpo.",
  rooms: [
    {
      id: "r1",
      name: "Sala",
      position: 0,
      notes: null,
      items: [
        { id: "t1", name: "Piso", position: 0, condition: "good", notes: null },
        { id: "t2", name: "Paredes", position: 1, condition: "fair", notes: "Furo de bucha" },
      ],
    },
    {
      id: "r2",
      name: "Cozinha",
      position: 1,
      notes: null,
      items: [{ id: "t3", name: "Torneira", position: 0, condition: "new", notes: null }],
    },
  ],
};

const saida: InspectionRecord = {
  ...entrada,
  id: "s1",
  kind: "moveOut",
  referenceInspectionId: entrada.id,
  rooms: [
    {
      id: "r9",
      name: "Sala",
      position: 0,
      notes: null,
      items: [
        {
          id: "t9",
          name: "Paredes",
          position: 0,
          condition: "poor",
          notes: "Mancha de umidade",
          referenceCondition: "fair",
          referenceNotes: "Furo de bucha",
        },
        // Posto depois na saída: sem cópia da entrada.
        { id: "t10", name: "Rodapé", position: 1, condition: "good", notes: null },
      ],
    },
  ],
};

const field = (view: ReturnType<typeof reportView>, label: string) =>
  view.state === "report"
    ? view.report.fields.find((each) => each.label === label)?.value
    : undefined;

describe("reportView", () => {
  it("vistoria em andamento não tem laudo: o aviso de concluir na tela de campo", () => {
    const view = reportView({ ...entrada, status: "inProgress", completedAt: undefined });

    expect(view).toEqual({ state: "inProgress", notice: REPORT_NOTICES.inProgress });
  });

  it("concluída sem o completedAt do servidor (a conclusão na fila) não tem laudo", () => {
    const { completedAt: _completedAt, completedBy: _completedBy, ...queued } = entrada;

    expect(reportView(queued)).toEqual({ state: "pending", notice: REPORT_NOTICES.pending });
    expect(reportView({ ...queued, version: null }).state).toBe("pending");
  });

  it("vistoria que o aparelho não tem, ou com a exclusão na fila: não encontrada", () => {
    expect(reportView(undefined)).toEqual({ state: "notFound", notice: REPORT_NOTICES.notFound });
    expect(reportView({ ...entrada, deleting: true }).state).toBe("notFound");
  });

  it("concluída e confirmada: o laudo mostra quem concluiu e a data da conclusão", () => {
    const view = reportView(entrada, { property: apto, client: horizonte });

    expect(field(view, "Conclusão")).toBe(
      "Concluída por Thiago Martins em 19/10/2026 às 11:47 (registrada pelo servidor)",
    );
    expect(field(view, "Início")).toBe("19/10/2026 às 09:12");
    // Baixada antes de o aparelho guardar o completedBy: a frase sai sem o nome.
    const { completedBy: _completedBy, ...older } = entrada;
    expect(field(reportView(older), "Conclusão")).toBe(
      "Concluída em 19/10/2026 às 11:47 (registrada pelo servidor)",
    );
  });

  it("a folha da entrada: o título, os dados formatados, os ambientes numerados e as observações gerais", () => {
    const view = reportView(entrada, { property: apto, client: horizonte });

    expect(view.state).toBe("report");
    if (view.state !== "report") return;
    expect(view.report.title).toBe("Laudo de vistoria de entrada");
    expect(view.report.fields.map((each) => each.label)).toEqual([
      "Imóvel",
      "Tipo de imóvel",
      "Cliente",
      "Início",
      "Conclusão",
      "Identificação",
    ]);
    expect(field(view, "Imóvel")).toBe(
      "Rua das Flores, 120 · ap 32 · Jardim Paulista · São Paulo/SP · 01400-000",
    );
    expect(field(view, "Tipo de imóvel")).toBe("Apartamento");
    expect(field(view, "Cliente")).toBe("Imobiliária Horizonte · CNPJ 12.345.678/0001-90");
    expect(field(view, "Identificação")).toBe(
      "0192f3a1-7c4e-7b2a-9d10-3e5f6a7b8c9d · versão AAAAAAAAB9E=",
    );
    expect(view.report.rooms.map((room) => room.title)).toEqual(["1. Sala", "2. Cozinha"]);
    expect(view.report.rooms[0]?.items).toEqual([
      { id: "t1", name: "Piso", condition: "Bom", notes: null },
      { id: "t2", name: "Paredes", condition: "Regular", notes: "Furo de bucha" },
    ]);
    expect(view.report.generalNotes).toBe("Imóvel entregue limpo.");
  });

  it("o laudo de uma saída mostra a condição da entrada de cada item, e a entrada de referência", () => {
    const view = reportView(saida, { property: apto, client: horizonte, reference: entrada });

    expect(view.state).toBe("report");
    if (view.state !== "report") return;
    expect(view.report.title).toBe("Laudo de vistoria de saída");
    expect(view.report.rooms[0]?.items).toEqual([
      {
        id: "t9",
        name: "Paredes",
        condition: "Ruim",
        notes: "Mancha de umidade",
        reference: { condition: "Regular", notes: "Furo de bucha" },
      },
      { id: "t10", name: "Rodapé", condition: "Bom", notes: null },
    ]);
    expect(field(view, "Entrada")).toBe(
      "Laudo de entrada de 19/10/2026 às 11:47 · 0192f3a1-7c4e-7b2a-9d10-3e5f6a7b8c9d",
    );
    // Sem a entrada no aparelho, só o id dela.
    expect(field(reportView(saida), "Entrada")).toBe(entrada.id);
  });

  it("imóvel ou cliente fora do aparelho, e cliente pessoa física", () => {
    expect(field(reportView(entrada), "Imóvel")).toBe("—");
    expect(field(reportView(entrada), "Cliente")).toBe("—");
    const cpf = { ...horizonte, name: "Maria Souza", document: "12345678909" };
    expect(field(reportView(entrada, { property: apto, client: cpf }), "Cliente")).toBe(
      "Maria Souza · CPF 123.456.789-09",
    );
  });
});
