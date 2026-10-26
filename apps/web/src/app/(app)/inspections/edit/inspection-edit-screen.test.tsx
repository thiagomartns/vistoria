import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import {
  saveInspection,
  saveInspectionDraft,
} from "@/features/inspections/services/inspections.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import { resetSyncStatus } from "@/shared/sync/sync-status";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { AppShell } from "../../app-shell";
import { InspectionEditScreen } from "./inspection-edit-screen";

// A tela de campo dentro do shell (Figma 43:1748, estados 0, 2, 3, 4 e 6), com o banco local simulado no hook e o
// rascunho e a fila espionados. Os debounces são os de verdade: 300 ms para o rascunho, 1,5 s para a fila.

const navigation = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inspections/edit",
  useRouter: () => ({ push: vi.fn<() => void>(), replace: vi.fn<() => void>() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => {} }));

const EMPTY = {
  store: { drafts: {} },
  ready: true,
  clients: [] as ClientRecord[],
  properties: [] as PropertyRecord[],
  inspections: [] as InspectionRecord[],
  drafts: [] as DraftRecord[],
  states: new Map<string, RecordSyncState>(),
  bases: new Map<string, Record<string, unknown> | undefined>(),
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/inspections/services/inspections.sync", () => ({
  saveInspection: vi.fn<() => string>(() => "i1"),
  saveInspectionDraft: vi.fn<() => void>(),
}));

const lar: ClientRecord = {
  id: "c1",
  version: "AAAAAAAAB9M=",
  name: "Imobiliária Lar",
  document: null,
  email: null,
  phone: null,
};

const apto: PropertyRecord = {
  id: "p1",
  version: "AAAAAAAAB9N=",
  clientId: "c1",
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

const item = (
  id: string,
  name: string,
  position: number,
  condition: InspectionRecord["rooms"][number]["items"][number]["condition"] = null,
  notes: string | null = null,
) => ({
  id,
  name,
  position,
  condition,
  notes,
});

const vistoria: InspectionRecord = {
  id: "i1",
  version: "AAAAAAAAB9O=",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: new Date(2026, 9, 19, 9, 12).toISOString(),
  generalNotes: null,
  rooms: [
    {
      id: "r1",
      name: "Sala",
      position: 0,
      notes: null,
      items: [item("t1", "Piso", 0, "good"), item("t2", "Paredes", 1, "new")],
    },
    {
      id: "r2",
      name: "Cozinha",
      position: 1,
      notes: null,
      items: [
        item("t3", "Piso", 0, "good"),
        item("t4", "Paredes", 1, "fair", "Mancha de umidade atrás da geladeira."),
        item("t5", "Bancada", 2),
      ],
    },
    { id: "r3", name: "Varanda", position: 2, notes: null, items: [] },
  ],
};

function open(over: Partial<typeof EMPTY> = {}) {
  navigation.search = "?id=i1";
  local.value = { ...EMPTY, clients: [lar], properties: [apto], inspections: [vistoria], ...over };
  return render(
    <AppShell>
      <InspectionEditScreen />
    </AppShell>,
  );
}

const heading = () => screen.getByRole("heading", { level: 1 });
const steps = () => screen.getByRole("navigation", { name: "Ambientes" });
const chips = (name: string) => screen.getByRole("radiogroup", { name: `Condição: ${name}` });
const chip = (itemName: string, label: string) =>
  within(chips(itemName)).getByRole("radio", { name: label });
const currentStep = () => within(steps()).getByRole("button", { current: "step" });

const draftOf = (over: Partial<DraftRecord>): DraftRecord => ({
  id: "i1",
  entity: "inspection",
  data: vistoria,
  status: "draft",
  errors: {},
  updatedAt: "2026-10-26T13:00:00.000Z",
  ...over,
});

afterEach(() => {
  vi.mocked(saveInspection).mockClear();
  vi.mocked(saveInspectionDraft).mockClear();
  resetSyncStatus();
  resetSession();
});

describe("InspectionEditScreen", () => {
  it("estado 0: o endereço e o subtítulo no header, o primeiro ambiente e as etapas; modo foco, sem a barra inferior", () => {
    open();

    expect(heading().textContent).toBe("R. das Flores, 120 · Apto 302");
    expect(
      screen.getByText("Vistoria de entrada · Imobiliária Lar · iniciada em 19/10 às 09:12"),
    ).toBeDefined();
    expect(screen.getAllByRole("navigation", { name: "Principal" })).toHaveLength(1);
    expect(currentStep().textContent).toContain("Sala");
    expect(within(steps()).getByText("2 de 2")).toBeDefined();
    expect(within(steps()).getByText("2 de 3")).toBeDefined();
    expect(screen.getByText("1 de 3 concluídos")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Sala" })).toBeDefined();
    expect(screen.getByText("2 de 2 itens avaliados")).toBeDefined();
    expect(screen.getByText("Sala · 1 de 3")).toBeDefined();
    expect(chip("Piso", "Bom").getAttribute("aria-checked")).toBe("true");
    expect(chip("Paredes", "Novo").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Não enviado")).toBeNull();
  });

  it("observação com texto vem aberta; sem texto, sob demanda", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Próximo" }));

    expect((screen.getByLabelText("Observação: Paredes") as HTMLTextAreaElement).value).toBe(
      "Mancha de umidade atrás da geladeira.",
    );
    expect(screen.getByRole("button", { name: "Adicionar observação: Bancada" })).toBeDefined();
  });

  it("estado 2: ambiente sem itens mostra o EmptyState, sem ação; no último ambiente, Próximo desabilitado", async () => {
    const user = userEvent.setup();
    open();

    await user.click(within(steps()).getByRole("button", { name: /Varanda/ }));

    expect(screen.getByText("Nenhum item neste ambiente")).toBeDefined();
    expect(screen.getByText("Nenhum item ainda")).toBeDefined();
    expect(within(steps()).getByText("0 itens")).toBeDefined();
    expect((screen.getByRole("button", { name: "Próximo" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("marcar um chip: vai para o rascunho, depois para a fila, e o item fica 'Não enviado'", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Próximo" }));

    await user.click(chip("Bancada", "Ruim"));

    expect(chip("Bancada", "Ruim").getAttribute("aria-checked")).toBe("true");
    await vi.waitFor(() =>
      expect(vi.mocked(saveInspectionDraft).mock.lastCall?.[1].rooms[1]?.items[2]?.condition).toBe(
        "poor",
      ),
    );
    expect(vi.mocked(saveInspectionDraft).mock.lastCall?.[2]).toBe(1);
    expect(saveInspection).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(vi.mocked(saveInspection).mock.calls[0]?.[1].rooms[1]?.items[2]?.condition).toBe("poor");
    expect(screen.getByText("Não enviado")).toBeDefined();
  });

  it("logo depois de ir para a fila (antes de a outbox ser lida), o item segue 'Não enviado'; confirmado, some", async () => {
    const user = userEvent.setup();
    const view = open();
    await user.click(chip("Paredes", "Ruim"));
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });

    // O otimista já tem a mudança, e a outbox ainda não foi lida: sem base na fila.
    const optimistic = structuredClone(vistoria);
    optimistic.rooms[0]!.items[1]!.condition = "poor";
    local.value = { ...local.value, inspections: [optimistic] };
    view.rerender(
      <AppShell>
        <InspectionEditScreen />
      </AppShell>,
    );
    expect(screen.getByText("Não enviado")).toBeDefined();

    local.value = { ...local.value, inspections: [{ ...optimistic, version: "AAAAAAAAB9P=" }] };
    view.rerender(
      <AppShell>
        <InspectionEditScreen />
      </AppShell>,
    );
    expect(screen.queryByText("Não enviado")).toBeNull();
  });

  it("formulário sem mudança não vai para a fila, nem ao trocar de ambiente (ADR 0028)", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Próximo" }));
    await new Promise((done) => setTimeout(done, 1700));

    expect(saveInspection).not.toHaveBeenCalled();
    expect(saveInspectionDraft).toHaveBeenCalled();
    expect(vi.mocked(saveInspectionDraft).mock.lastCall?.[2]).toBe(1);
  });

  it("fechar a aba no meio de um ambiente e reabrir: o ambiente e os valores voltam do rascunho, e o que faltou vai para a fila", async () => {
    const changed = structuredClone(vistoria);
    changed.rooms[1]!.items[2]!.condition = "absent";
    open({ drafts: [draftOf({ data: changed, step: 1 })] });

    expect(currentStep().textContent).toContain("Cozinha");
    await vi.waitFor(() =>
      expect(chip("Bancada", "Ausente").getAttribute("aria-checked")).toBe("true"),
    );
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(vi.mocked(saveInspection).mock.calls[0]?.[1].rooms[1]?.items[2]?.condition).toBe(
      "absent",
    );
  });

  it("estado 3 (offline, transação na fila): segue editável e uma mudança vai de novo para a fila (ADR 0021)", async () => {
    const user = userEvent.setup();
    open({
      states: new Map([["i1", "local"]]),
      bases: new Map([
        [
          "i1",
          {
            ...vistoria,
            rooms: [
              {
                ...vistoria.rooms[0],
                items: [item("t1", "Piso", 0), item("t2", "Paredes", 1, "new")],
              },
            ],
          },
        ],
      ]),
    });

    expect(within(screen.getByText("Piso").parentElement!).getByText("Não enviado")).toBeDefined();
    expect(screen.getAllByText("Não enviado")).toHaveLength(1);

    await user.click(chip("Paredes", "Ruim"));

    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(screen.getAllByText("Não enviado")).toHaveLength(2);
  });

  it("estado 4 (envio no ar): chips e observação só leitura, Anterior e Próximo ativos", async () => {
    const user = userEvent.setup();
    open({ states: new Map([["i1", "enviando"]]), bases: new Map([["i1", undefined]]) });

    expect((chip("Piso", "Novo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Adicionar observação/ })).toBeNull();
    expect(screen.getAllByText("Enviando").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Próximo" }));

    expect(currentStep().textContent).toContain("Cozinha");
    expect((screen.getByLabelText("Observação: Paredes") as HTMLTextAreaElement).readOnly).toBe(
      true,
    );
  });

  it("estado 6: 400 num item volta ao chip certo, no ambiente certo, com 'Revisar' e o aviso", async () => {
    const sent = structuredClone(vistoria);
    open({
      drafts: [
        draftOf({
          data: sent,
          status: "rejected",
          step: 0,
          errors: { "rooms[1].items[2].condition": ["Escolha a condição."] },
        }),
      ],
    });

    expect(currentStep().textContent).toContain("Cozinha");
    const message = await screen.findByText("Escolha a condição.");
    expect(chips("Bancada").getAttribute("aria-invalid")).toBe("true");
    expect(chips("Piso").getAttribute("aria-invalid")).toBe("false");
    expect(message.closest("[data-slot=form-item]")?.contains(chips("Bancada"))).toBe(true);
    expect(screen.getByText("Revisar")).toBeDefined();
    expect(currentStep().textContent).toContain("1 erro");
    expect(screen.getByText("O servidor recusou esta vistoria")).toBeDefined();
    expect(
      screen.getByText("Cozinha: 1 item precisa de correção. Corrija e ela é enviada de novo."),
    ).toBeDefined();
    expect(within(heading().closest("header")!).getByText("Correção necessária")).toBeDefined();
  });

  it("corrigir o chip recusado tira o erro e manda de novo para a fila", async () => {
    const user = userEvent.setup();
    open({
      drafts: [
        draftOf({
          status: "rejected",
          step: 1,
          errors: { "rooms[1].items[2].condition": ["Escolha a condição."] },
        }),
      ],
    });
    await screen.findByText("Escolha a condição.");

    await user.click(chip("Bancada", "Bom"));

    expect(screen.queryByText("Escolha a condição.")).toBeNull();
    expect(chips("Bancada").getAttribute("aria-invalid")).toBe("false");
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
  });

  it("recusada e reaberta sem mudança: não volta sozinha para a fila, mesmo com o otimista desfeito", async () => {
    const sent = structuredClone(vistoria);
    sent.rooms[0]!.items[1]!.condition = "poor";
    open({
      drafts: [draftOf({ data: sent, status: "rejected", errors: { "rooms[1].items[2].condition": ["Escolha a condição."] } })],
    });
    await screen.findByText("Escolha a condição.");

    await new Promise((done) => setTimeout(done, 1700));

    expect(saveInspection).not.toHaveBeenCalled();
    expect(screen.getByText("Escolha a condição.")).toBeDefined();
  });

  it("recusa numa chave fora do formulário: o aviso traz a mensagem do servidor", async () => {
    open({
      drafts: [draftOf({ status: "rejected", errors: { propertyId: ["Imóvel não encontrado."] } })],
    });

    expect(await screen.findByText("Imóvel não encontrado.")).toBeDefined();
    expect(screen.getByText("O servidor recusou esta vistoria")).toBeDefined();
  });

  it("vistoria que não está no aparelho", () => {
    open({ inspections: [] });

    expect(screen.getByText("Esta vistoria não está neste aparelho.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe(
      "/inspections",
    );
  });
});
