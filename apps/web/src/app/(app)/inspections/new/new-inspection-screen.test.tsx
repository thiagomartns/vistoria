import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import type { InspectionSummary } from "@/features/inspections/models/inspection-summary";
import { saveInspection } from "@/features/inspections/services/inspections.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import type { TemplateRecord } from "@/features/templates/models/template";
import { resetSession } from "@/shared/auth/session";
import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "../../app-shell";
import { NewInspectionScreen } from "./new-inspection-screen";

// /inspections/new (wireframes 68:1644 e 68:1878, e a seção "Nova vistoria · roteiro (#174)"), com o banco local simulado no hook, os resumos e a vistoria por id
// simulados, e o saveInspection espionado.

const navigation = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inspections/new",
  useRouter: () => ({ push: navigation.push, replace: vi.fn<() => void>() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => {} }));

const local = vi.hoisted(() => ({
  value: {
    store: {},
    ready: true,
    clients: [] as ClientRecord[],
    properties: [] as PropertyRecord[],
    templates: [] as TemplateRecord[],
    drafts: [],
    states: new Map(),
    pending: new Map<string, { mutationFnName: string; record: unknown; removed: boolean }>(),
    outboxRead: true,
  },
}));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

// Os resumos que a lista lê (ADR 0048) e as vistorias completas que o aparelho tem, por id.
const inspections = vi.hoisted(() => ({
  summaries: [] as InspectionSummary[],
  records: new Map<string, InspectionRecord>(),
}));

vi.mock("@/features/inspections/hooks/useInspectionSummaries", () => ({
  useInspectionSummaries: () => ({ data: inspections.summaries, isReady: true }),
}));

vi.mock("@/features/inspections/hooks/useInspectionRecord", () => ({
  useInspectionRecord: (_store: unknown, id: string | null) => ({
    record: id ? inspections.records.get(id) : undefined,
    ready: true,
  }),
}));

vi.mock("@/features/inspections/services/inspections.sync", () => ({
  saveInspection: vi.fn<() => string>(() => "nova"),
  UPSERT_INSPECTION: "upsertInspection",
  DELETE_INSPECTION: "deleteInspection",
}));

const lar: ClientRecord = {
  id: "c1",
  version: "A",
  name: "Imobiliária Lar",
  document: null,
  email: null,
  phone: null,
};

const property = (id: string, street: string): PropertyRecord => ({
  id,
  version: "A",
  clientId: "c1",
  street,
  number: "120",
  complement: null,
  district: "Centro",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: null,
});

// Um roteiro do aparelho, com os ambientes e itens na ordem dada.
const template = (id: string, name: string, rooms: [string, string[]][]): TemplateRecord => ({
  id,
  version: "A",
  name,
  rooms: rooms.map(([room, items], position) => ({
    id: `${id}-${position}`,
    name: room,
    position,
    items: items.map((item, index) => ({ id: `${id}-${position}-${index}`, name: item, position: index })),
  })),
});

function open(properties: PropertyRecord[]) {
  local.value = { ...local.value, clients: [lar], properties };
  return render(
    <AppShell>
      <NewInspectionScreen />
    </AppShell>,
  );
}

// Uma entrada do imóvel: concluída, com a Sala avaliada.
const moveIn = (id: string, propertyId: string, startedAt: string): InspectionRecord => ({
  id,
  version: "A",
  propertyId,
  kind: "moveIn",
  status: "completed",
  completedAt: startedAt,
  startedAt,
  generalNotes: null,
  rooms: [
    {
      id: `${id}-sala`,
      name: "Sala",
      position: 0,
      notes: null,
      items: [
        { id: `${id}-piso`, name: "Piso", position: 0, condition: "good", notes: null },
        { id: `${id}-paredes`, name: "Paredes", position: 1, condition: "fair", notes: "Pintura nova." },
      ],
    },
  ],
});

const summaryOf = (record: InspectionRecord): InspectionSummary => ({
  id: record.id,
  version: record.version,
  propertyId: record.propertyId,
  kind: record.kind,
  status: record.status,
  startedAt: record.startedAt,
  evaluated: 2,
  items: 2,
});

async function chooseMoveOut(user: ReturnType<typeof userEvent.setup>, propertyLabel: string) {
  await user.click(screen.getByLabelText("Imóvel"));
  await user.click(await screen.findByRole("option", { name: propertyLabel }));
  await user.click(screen.getByRole("radio", { name: "Saída" }));
}

afterEach(() => {
  inspections.summaries = [];
  inspections.records = new Map();
  local.value = { ...local.value, templates: [], pending: new Map() };
  navigation.push.mockReset();
  vi.mocked(saveInspection).mockClear();
  resetSyncStatus();
  resetSession();
});

describe("NewInspectionScreen", () => {
  it("Tipo com Entrada marcada e Saída disponível; sem roteiro no aparelho, o padrão e o link para Roteiros; Voltar e Cancelar para a lista", () => {
    open([property("p1", "Rua das Flores")]);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nova vistoria");
    expect(screen.getByRole("radio", { name: "Entrada" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect((screen.getByRole("radio", { name: "Saída" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByLabelText("Roteiro").textContent).toBe(
      "Roteiro padrão · 5 ambientes, 29 itens",
    );
    const description = screen.getByText(/Nenhum roteiro neste aparelho: a entrada parte do roteiro padrão/);
    expect(within(description).getByRole("link", { name: "Roteiros" }).getAttribute("href")).toBe(
      "/templates",
    );
    expect(screen.getByRole("link", { name: "Cancelar" }).getAttribute("href")).toBe(
      "/inspections",
    );
    expect(screen.getByRole("link", { name: "Voltar" }).getAttribute("href")).toBe("/inspections");
  });

  it("sem imóvel escolhido, pede o imóvel e não cria", async () => {
    const user = userEvent.setup();
    open([property("p1", "Rua das Flores")]);

    await user.click(screen.getByRole("button", { name: "Começar vistoria" }));

    expect(await screen.findByText("Escolha o imóvel.")).toBeDefined();
    expect(saveInspection).not.toHaveBeenCalled();
  });

  it("escolher o imóvel e começar, sem roteiro no aparelho: cria a entrada pelo roteiro padrão e abre a tela de campo", async () => {
    const user = userEvent.setup();
    open([property("p2", "Rua do Porto"), property("p1", "Rua das Flores")]);

    await user.click(screen.getByLabelText("Imóvel"));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Rua das Flores, 120 · Imobiliária Lar",
      "Rua do Porto, 120 · Imobiliária Lar",
    ]);
    await user.click(options[0]!);
    await user.click(screen.getByRole("button", { name: "Começar vistoria" }));

    await vi.waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/inspections/edit?id=nova"),
    );
    const created = vi.mocked(saveInspection).mock.calls[0]?.[1];
    expect(created).toMatchObject({ propertyId: "p1", kind: "moveIn", status: "inProgress" });
    expect(created?.rooms.map((room) => room.name)).toEqual([
      "Sala",
      "Cozinha",
      "Banheiro",
      "Quarto",
      "Área de serviço",
    ]);
  });

  it("com roteiros no aparelho: lista os que têm ambiente por nome, o primeiro escolhido, e a entrada copia o escolhido com ids novos", async () => {
    const user = userEvent.setup();
    const sala = template("t-sala", "Sala comercial", [
      ["Recepção", ["Piso", "Vidraça"]],
      ["Copa", ["Pia"]],
    ]);
    local.value = {
      ...local.value,
      templates: [sala, template("t-casa", "Casa térrea", [["Quintal", ["Muro"]]]), template("t-vazio", "Vazio", [])],
    };
    open([property("p1", "Rua das Flores")]);

    const select = screen.getByLabelText("Roteiro");
    expect(select.textContent).toBe("Casa térrea · 1 ambiente, 1 item");
    expect(screen.queryByText(/Nenhum roteiro neste aparelho/)).toBeNull();
    expect(
      screen.getByText(
        "Ambientes e itens são copiados para a vistoria; depois de criada, ela não depende mais do roteiro.",
      ),
    ).toBeDefined();
    await user.click(select);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Casa térrea · 1 ambiente, 1 item",
      "Sala comercial · 2 ambientes, 3 itens",
    ]);
    await user.click(screen.getByRole("option", { name: "Sala comercial · 2 ambientes, 3 itens" }));
    await user.click(screen.getByLabelText("Imóvel"));
    await user.click(await screen.findByRole("option", { name: "Rua das Flores, 120 · Imobiliária Lar" }));
    await user.click(screen.getByRole("button", { name: "Começar vistoria" }));

    await vi.waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/inspections/edit?id=nova"),
    );
    const created = vi.mocked(saveInspection).mock.calls[0]?.[1];
    expect(created).toMatchObject({ propertyId: "p1", kind: "moveIn", status: "inProgress" });
    expect(created?.rooms.map((room) => [room.name, room.items.map((item) => item.name)])).toEqual([
      ["Recepção", ["Piso", "Vidraça"]],
      ["Copa", ["Pia"]],
    ]);
    const templateIds = sala.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]);
    const ids = created?.rooms.flatMap((room) => [room.id, ...room.items.map((item) => item.id)]) ?? [];
    expect(ids.some((id) => templateIds.includes(id))).toBe(false);
  });

  it("sem imóvel no aparelho: o aviso leva ao cadastro, e começar fica desabilitado", () => {
    open([]);

    expect(
      screen.getByText("Nenhum imóvel neste aparelho. Cadastre um imóvel antes de começar."),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Cadastrar imóvel" }).getAttribute("href")).toBe(
      "/properties/edit",
    );
    expect(
      (screen.getByRole("button", { name: "Começar vistoria" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  // Wireframe 68:1759: o imóvel só tem uma entrada em andamento (e a concluída é de outro imóvel).
  it("imóvel sem entrada concluída não oferece a saída: o aviso, nenhuma entrada e começar desabilitado", async () => {
    const user = userEvent.setup();
    const inProgress = { ...moveIn("andamento", "p1", "2026-10-20T09:00:00Z"), status: "inProgress" as const };
    inspections.summaries = [summaryOf(inProgress), summaryOf(moveIn("outra", "p2", "2026-10-21T09:00:00Z"))];
    open([property("p1", "Rua das Flores"), property("p2", "Rua do Porto")]);

    await chooseMoveOut(user, "Rua das Flores, 120 · Imobiliária Lar");

    expect(screen.getByText("Este imóvel não tem vistoria de entrada concluída")).toBeDefined();
    expect(screen.queryByLabelText("Vistoria de entrada")).toBeNull();
    expect(screen.queryByLabelText("Roteiro")).toBeNull();
    const start = screen.getByRole("button", { name: "Começar vistoria" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await user.click(start);
    expect(saveInspection).not.toHaveBeenCalled();
  });

  // Wireframe 68:1646: a mais recente vem escolhida; a concluída offline, ainda na fila, também conta.
  it("saída: lista as entradas concluídas do imóvel, a mais recente escolhida, e cria a saída copiada dela", async () => {
    const user = userEvent.setup();
    const older = moveIn("antiga", "p1", new Date(2026, 2, 1, 9, 0).toISOString());
    const newer = moveIn("recente", "p1", new Date(2026, 9, 20, 14, 30).toISOString());
    inspections.summaries = [summaryOf(older)];
    inspections.records = new Map([
      [older.id, older],
      [newer.id, newer],
    ]);
    local.value = {
      ...local.value,
      pending: new Map([
        [newer.id, { mutationFnName: "upsertInspection", record: newer, removed: false }],
      ]),
    };
    open([property("p1", "Rua das Flores")]);

    await chooseMoveOut(user, "Rua das Flores, 120 · Imobiliária Lar");

    const select = screen.getByLabelText("Vistoria de entrada");
    expect(select.textContent).toBe("Entrada de 20/10/2026 às 14:30 · 2 itens");
    await user.click(select);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Entrada de 20/10/2026 às 14:30 · 2 itens",
      "Entrada de 01/03/2026 às 09:00 · 2 itens",
    ]);
    await user.click(screen.getByRole("option", { name: "Entrada de 20/10/2026 às 14:30 · 2 itens" }));
    await user.click(screen.getByRole("button", { name: "Começar vistoria" }));

    await vi.waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/inspections/edit?id=nova"),
    );
    const created = vi.mocked(saveInspection).mock.calls[0]?.[1];
    expect(created).toMatchObject({
      propertyId: "p1",
      kind: "moveOut",
      status: "inProgress",
      referenceInspectionId: "recente",
    });
    expect(created?.rooms[0]?.items.map(({ id: _id, ...item }) => item)).toEqual([
      { name: "Piso", position: 0, condition: null, notes: null, referenceCondition: "good", referenceNotes: null },
      {
        name: "Paredes",
        position: 1,
        condition: null,
        notes: null,
        referenceCondition: "fair",
        referenceNotes: "Pintura nova.",
      },
    ]);
  });
});
