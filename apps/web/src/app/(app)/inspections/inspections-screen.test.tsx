import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import type { PropertyRecord } from "@/features/properties/models/property";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { InspectionsScreen } from "./inspections-screen";

// /inspections (wireframe 67:1490 e 67:1649), com o banco local simulado no hook.

const EMPTY = {
  store: {},
  ready: true,
  clients: [] as ClientRecord[],
  properties: [] as PropertyRecord[],
  inspections: [] as InspectionRecord[],
  drafts: [] as DraftRecord[],
  states: new Map<string, RecordSyncState>(),
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

const horizonte: ClientRecord = {
  id: "c1",
  version: "A",
  name: "Imobiliária Horizonte",
  document: null,
  email: null,
  phone: null,
};

const flores: PropertyRecord = {
  id: "p1",
  version: "A",
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

const inspection = (id: string, over: Partial<InspectionRecord> = {}): InspectionRecord => ({
  id,
  version: "A",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: new Date(2026, 9, 19, 9, 12).toISOString(),
  generalNotes: null,
  rooms: [],
  ...over,
});

function open(over: Partial<typeof EMPTY> = {}) {
  local.value = { ...EMPTY, clients: [horizonte], properties: [flores], ...over };
  return render(<InspectionsScreen />);
}

afterEach(() => {
  local.value = EMPTY;
});

describe("InspectionsScreen", () => {
  it("vazia: EmptyState com 'Nova vistoria'", () => {
    open();

    expect(screen.getByText("Nenhuma vistoria ainda")).toBeDefined();
    expect(screen.getByRole("link", { name: "Nova vistoria" }).getAttribute("href")).toBe(
      "/inspections/new",
    );
  });

  it("antes de o banco local abrir, nada", () => {
    const { container } = open({ ready: false });

    expect(container.textContent).toBe("");
  });

  it("lista: imóvel, cliente, tipo, status, início; SyncBadge só fora do sincronizado; a linha abre a tela de campo", () => {
    open({
      inspections: [
        inspection("i1"),
        inspection("i2", {
          status: "completed",
          startedAt: new Date(2026, 9, 20, 8, 0).toISOString(),
        }),
      ],
      states: new Map([["i1", "local"]]),
    });

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      [
        "Rua das Flores, 120 · ap 32",
        "Imobiliária Horizonte",
        "Entrada",
        "Em andamento",
        "19/10/2026",
        "Salvo no aparelho",
      ],
      [
        "Rua das Flores, 120 · ap 32",
        "Imobiliária Horizonte",
        "Entrada",
        "Concluída",
        "20/10/2026",
        "",
      ],
    ]);
    expect(within(rows[0]!).getByRole("link").getAttribute("href")).toBe("/inspections/edit?id=i1");
    expect(screen.getByText("2 vistorias")).toBeDefined();

    const mobile = within(screen.getByRole("list")).getAllByRole("link");
    expect(mobile[0]?.textContent).toContain("Imobiliária Horizonte · Entrada");
    expect(mobile[0]?.textContent).toContain("Iniciada em 19/10, 09:12");
  });

  it("recusada no servidor: a linha mostra 'Correção necessária'", () => {
    const sent = inspection("i1");
    open({
      inspections: [sent],
      drafts: [
        {
          id: "i1",
          entity: "inspection",
          data: sent,
          status: "rejected",
          errors: { "rooms[0].items[0].condition": ["Escolha a condição."] },
          step: 0,
          updatedAt: "2026-10-26T13:00:00.000Z",
        },
      ],
    });

    expect(within(screen.getByRole("table")).getByText("Correção necessária")).toBeDefined();
  });

  it("em conflito: a linha mostra 'Conflito' e abre o ConflictResolver desta vistoria", () => {
    const sent = inspection("i1");
    open({
      inspections: [inspection("i0", { startedAt: new Date(2026, 9, 18, 9).toISOString() }), sent],
      drafts: [
        {
          id: "i1",
          entity: "inspection",
          data: sent,
          status: "conflict",
          errors: {},
          conflict: { current: { ...sent, version: "B" }, base: sent, collisions: [] },
          step: 0,
          updatedAt: "2026-10-26T13:00:00.000Z",
        },
      ],
    });

    const row = within(screen.getByRole("table"))
      .getByText("Conflito")
      .closest("tr") as HTMLElement;
    expect(within(row).getByRole("link").getAttribute("href")).toBe("/inspections/conflict?id=i1");
    const [mobile, other] = within(screen.getByRole("list")).getAllByRole("link");
    expect(mobile?.textContent).toContain("Conflito");
    expect(mobile?.getAttribute("href")).toBe("/inspections/conflict?id=i1");
    expect(other?.getAttribute("href")).toBe("/inspections/edit?id=i0");
  });
});
