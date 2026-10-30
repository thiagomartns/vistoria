import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const deleteInspection = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
);

vi.mock("@/features/inspections/services/inspections.sync", async (original) => ({
  ...(await original<object>()),
  deleteInspection,
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
  deleteInspection.mockClear();
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
        "",
      ],
      [
        "Rua das Flores, 120 · ap 32",
        "Imobiliária Horizonte",
        "Entrada",
        "Concluída",
        "20/10/2026",
        "",
        "",
      ],
    ]);
    // Só a em andamento tem o "···" (estado 4 do #107).
    expect(within(rows[0]!).getByRole("button", { name: "Mais ações" })).toBeDefined();
    expect(within(rows[1]!).queryByRole("button", { name: "Mais ações" })).toBeNull();
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

  it("··· → Excluir vistoria → confirmar: a exclusão vai para a fila; Cancelar não faz nada", async () => {
    const user = userEvent.setup();
    open({ inspections: [inspection("i1")], states: new Map([["i1", "local"]]) });
    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;

    await user.click(within(row).getByRole("button", { name: "Mais ações" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir vistoria" }));
    const dialog = screen.getByRole("dialog", { name: "Excluir esta vistoria?" });
    // Com alteração na fila, o Dialog avisa que ela é descartada (estado 3).
    expect(dialog.textContent).toContain(
      "Rua das Flores, 120 · ap 32 · Vistoria de entrada. Ela sai deste aparelho e do servidor, e não dá para desfazer.",
    );
    expect(dialog.textContent).toContain(
      "As alterações ainda não enviadas também são descartadas.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(deleteInspection).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: "Mais ações" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir vistoria" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir vistoria" }),
    );

    expect(deleteInspection).toHaveBeenCalledWith(local.value.store, "i1");
  });

  it("sincronizada: o Dialog não fala de alteração não enviada", async () => {
    const user = userEvent.setup();
    open({ inspections: [inspection("i1")] });

    await user.click(screen.getByRole("button", { name: "Mais ações" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir vistoria" }));

    expect(screen.getByRole("dialog").textContent).not.toContain("não enviadas");
  });

  it("com a exclusão na fila: a linha fica apagada, com 'Excluindo' e sem o ···, e ainda abre a tela de campo", () => {
    open({
      inspections: [inspection("i1", { deleting: true })],
      states: new Map([["i1", "enviando"]]),
    });

    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(row.className).toContain("text-muted-foreground");
    expect(within(row).getByText("Excluindo")).toBeDefined();
    expect(within(row).queryByRole("button", { name: "Mais ações" })).toBeNull();
    expect(within(row).getByRole("link").getAttribute("href")).toBe("/inspections/edit?id=i1");
    const mobile = within(screen.getByRole("list")).getByRole("link");
    expect(mobile.textContent).toContain("Excluindo");
  });

  it("excluída em outro aparelho e sem pendência: o pull a tira do banco local com o rascunho limpo, e a linha sai", () => {
    const kept = inspection("i2", { startedAt: new Date(2026, 9, 20, 8, 0).toISOString() });
    const clean: DraftRecord = {
      id: "i1",
      entity: "inspection",
      data: inspection("i1"),
      status: "draft",
      step: 0,
      errors: {},
      updatedAt: "2026-10-29T10:00:00.000Z",
    };
    const view = open({ inspections: [inspection("i1"), kept], drafts: [clean] });
    const rows = () => within(screen.getByRole("list")).getAllByRole("link");
    expect(rows()).toHaveLength(2);

    local.value = { ...local.value, inspections: [kept], drafts: [] };
    view.rerender(<InspectionsScreen />);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.getAttribute("href")).toBe("/inspections/edit?id=i2");
  });
});
