import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionSummary } from "@/features/inspections/models/inspection-summary";
import type { PropertyRecord } from "@/features/properties/models/property";
import { fetchProperty, saveProperty } from "@/features/properties/services/properties.sync";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { FetchOutcome } from "@/shared/sync/fetch";
import { resetSyncStatus } from "@/shared/sync/sync-status";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { AppShell } from "../../app-shell";
import { PropertyEditScreen } from "./property-edit-screen";

// A tela dentro do shell (o header é dele), com o banco local simulado no hook e o saveProperty espionado.

const navigation = vi.hoisted(() => ({
  search: "",
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/properties/edit",
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => {} }));

const local = vi.hoisted(() => ({
  value: {
    store: {},
    ready: true,
    clients: [] as ClientRecord[],
    properties: [] as PropertyRecord[],
    drafts: [] as DraftRecord[],
    states: new Map<string, RecordSyncState>(),
    pending: new Map<string, { mutationFnName: string; record: unknown; removed: boolean }>(),
    outboxRead: true,
  },
}));

// Os resumos das vistorias que a lista lê (ADR 0048).
const inspections = vi.hoisted(() => ({ summaries: [] as InspectionSummary[] }));

vi.mock("@/features/inspections/hooks/useInspectionSummaries", () => ({
  useInspectionSummaries: () => ({ data: inspections.summaries, isReady: true }),
}));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/properties/services/properties.sync", () => ({
  saveProperty: vi.fn<() => string>(() => "novo-id"),
  fetchProperty: vi.fn<(store: unknown, id: string) => Promise<FetchOutcome>>(async () => "not-found"),
  propertyConflictHref: (id: string) => `/properties/conflict?id=${id}`,
}));

const client = (id: string, name: string): ClientRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  name,
  document: null,
  email: null,
  phone: null,
});
// Ids de verdade são UUID v7, e o schema confere.
const C1 = "01a16032-2dfb-77de-84a2-1f165bdd9901";
const C2 = "01a16032-2dfb-77de-84a2-1f165bdd9902";
const horizonte = client(C1, "Imobiliária Horizonte");
const lar = client(C2, "Lar Imóveis");

const flores: PropertyRecord = {
  id: "p1",
  version: "AAAAAAAAB9M=",
  clientId: C1,
  street: "Rua das Flores",
  number: "120",
  complement: "ap 32",
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: "Portaria 24h.",
};

function open(id: string | null, over: Partial<typeof local.value> = {}, tab?: string) {
  navigation.search = id ? `?id=${id}${tab ? `&tab=${tab}` : ""}` : "";
  local.value = { ...local.value, clients: [lar, horizonte], ...over };
  return render(
    <AppShell>
      <PropertyEditScreen />
    </AppShell>,
  );
}

const heading = () => screen.getByRole("heading", { level: 1 });
const header = () => heading().closest("header")!;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const itemOf = (control: HTMLElement) => control.closest("[data-slot=form-item]") as HTMLElement;

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(field(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await choose(user, "Cliente", "Imobiliária Horizonte");
  await choose(user, "Tipo", "Casa");
  await user.type(field("CEP"), "11010-000");
  await user.type(field("Rua"), "Rua do Porto");
  await user.type(field("Número"), "12");
  await user.type(field("Bairro"), "Centro");
  await user.type(field("Cidade"), "Santos");
  await user.type(field("UF"), "sp");
}

afterEach(() => {
  local.value = {
    store: {},
    ready: true,
    clients: [],
    properties: [],
    drafts: [],
    states: new Map(),
    pending: new Map(),
    outboxRead: true,
  };
  inspections.summaries = [];
  vi.unstubAllGlobals();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  vi.mocked(saveProperty).mockClear();
  vi.mocked(fetchProperty).mockReset().mockResolvedValue("not-found");
  resetSyncStatus();
  resetSession();
});

describe("PropertyEditScreen", () => {
  it("novo: título 'Novo imóvel', Voltar para a lista, campos vazios, sem SyncBadge nem vistorias", () => {
    open(null);

    expect(heading().textContent).toBe("Novo imóvel");
    expect(within(header()).getByRole("link", { name: "Voltar" }).getAttribute("href")).toBe("/properties");
    expect(field("Cliente").textContent).toBe("Selecione o cliente");
    expect(field("Tipo").textContent).toBe("Selecione o tipo");
    for (const label of ["CEP", "Rua", "Número", "Complemento", "Bairro", "Cidade", "UF", "Observações"]) {
      expect(field(label).value).toBe("");
    }
    expect(within(header()).queryByText("Salvo no aparelho")).toBeNull();
    expect(screen.queryByText("Vistorias deste imóvel")).toBeNull();
    expect(screen.getByRole("link", { name: "Cancelar" }).getAttribute("href")).toBe("/properties");
  });

  it("o cliente se escolhe entre os do aparelho, em ordem alfabética", async () => {
    const user = userEvent.setup();
    open(null);

    await user.click(field("Cliente"));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Imobiliária Horizonte", "Lar Imóveis"]);
  });

  it("sem cliente no aparelho: o campo manda cadastrar um antes", () => {
    open(null, { clients: [] });

    const link = within(itemOf(field("Cliente"))).getByRole("link", { name: "Cadastre um cliente antes." });
    expect(link.getAttribute("href")).toBe("/clients/edit");
  });

  it("novo: valida no aparelho antes de salvar", async () => {
    const user = userEvent.setup();
    open(null);

    await user.type(field("CEP"), "1234");
    await user.type(field("UF"), "xx");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe o cliente.")).toBeDefined();
    expect(screen.getByText("Informe o tipo do imóvel.")).toBeDefined();
    expect(screen.getByText("Informe o CEP com 8 dígitos.")).toBeDefined();
    expect(screen.getByText("Informe a rua.")).toBeDefined();
    expect(screen.getByText("Informe a sigla de uma UF.")).toBeDefined();
    expect(saveProperty).not.toHaveBeenCalled();
  });

  it("novo: salvar grava no banco local (CEP sem hífen, UF em maiúsculas, vazio vira null) e volta", async () => {
    const user = userEvent.setup();
    open(null);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/properties"));
    expect(saveProperty).toHaveBeenCalledWith(local.value.store, {
      id: undefined,
      clientId: C1,
      type: "house",
      zipCode: "11010000",
      street: "Rua do Porto",
      number: "12",
      complement: null,
      district: "Centro",
      city: "Santos",
      state: "SP",
      notes: null,
    });
  });

  it("edição: o registro no formulário (CEP com hífen) e o endereço no título", () => {
    open("p1", { properties: [flores] });

    expect(heading().textContent).toBe("Rua das Flores, 120 · ap 32");
    expect(field("Cliente").textContent).toBe("Imobiliária Horizonte");
    expect(field("Tipo").textContent).toBe("Apartamento");
    expect(field("CEP").value).toBe("01400-000");
    expect(field("UF").value).toBe("SP");
    expect(field("Observações").value).toBe("Portaria 24h.");
    expect(header().querySelector('span[data-state="sincronizado"]')?.textContent).toBe("Sincronizado");
  });

  it("edição pendente: 'Salvo no aparelho' no cabeçalho", () => {
    open("p1", { properties: [flores], states: new Map([["p1", "local"]]) });

    expect(within(header()).getByText("Salvo no aparelho")).toBeDefined();
  });

  it("edição sem mudança não enfileira (ADR 0028), só volta", async () => {
    const user = userEvent.setup();
    open("p1", { properties: [flores] });

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/properties"));
    expect(saveProperty).not.toHaveBeenCalled();
  });

  it("o pull muda o registro com a tela aberta: salvar ainda enfileira o que a pessoa editou (#144)", async () => {
    const user = userEvent.setup();
    const { rerender } = open("p1", { properties: [flores] });
    await user.clear(field("Complemento"));
    await user.type(field("Complemento"), "ap 41");

    local.value = {
      ...local.value,
      properties: [{ ...flores, version: "AAAAAAAAB9Q=", notes: "Portaria 12h." }],
    };
    rerender(
      <AppShell>
        <PropertyEditScreen />
      </AppShell>,
    );
    await vi.waitFor(() => expect(field("Observações").value).toBe("Portaria 12h."));
    expect(field("Complemento").value).toBe("ap 41");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await vi.waitFor(() => expect(saveProperty).toHaveBeenCalledOnce());
    expect(vi.mocked(saveProperty).mock.calls[0]?.[1]).toMatchObject({
      id: "p1",
      complement: "ap 41",
      notes: "Portaria 12h.",
    });
  });

  it("edição com mudança enfileira o registro com o id", async () => {
    const user = userEvent.setup();
    open("p1", { properties: [flores] });

    await choose(user, "Cliente", "Lar Imóveis");
    await user.clear(field("Complemento"));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await vi.waitFor(() => expect(saveProperty).toHaveBeenCalledOnce());
    expect(vi.mocked(saveProperty).mock.calls[0]?.[1]).toMatchObject({
      id: "p1",
      clientId: C2,
      complement: null,
      zipCode: "01400000",
    });
  });

  describe("recusa do servidor (400 validation)", () => {
    const rejected = (errors: Record<string, string[]>): DraftRecord => ({
      id: "p1",
      entity: "property",
      data: { ...flores, state: "XX", zipCode: "0140000" },
      status: "rejected",
      errors,
      updatedAt: "2026-10-22T12:00:00.000Z",
    });

    it("os erros de state, zipCode e clientId voltam cada um no seu campo, com 'Correção necessária'", async () => {
      open("p1", {
        properties: [flores],
        drafts: [
          rejected({
            state: ["Informe a sigla de uma UF, em maiúsculas."],
            zipCode: ["Informe o CEP com 8 dígitos, sem hífen."],
            clientId: ["Cliente não encontrado."],
          }),
        ],
      });

      for (const [label, message] of [
        ["UF", "Informe a sigla de uma UF, em maiúsculas."],
        ["CEP", "Informe o CEP com 8 dígitos, sem hífen."],
        ["Cliente", "Cliente não encontrado."],
      ] as const) {
        const control = field(label);
        expect(within(itemOf(control)).getByText(message)).toBeDefined();
        expect(control.getAttribute("aria-invalid")).toBe("true");
      }
      expect(field("UF").value).toBe("XX");
      expect(field("CEP").value).toBe("0140000");
      expect(field("Rua").getAttribute("aria-invalid")).toBe("false");
      expect(within(header()).getByText("Correção necessária")).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("corrigir e salvar enfileira de novo", async () => {
      const user = userEvent.setup();
      open("p1", {
        properties: [flores],
        drafts: [rejected({ state: ["Informe a sigla de uma UF, em maiúsculas."] })],
      });

      await user.clear(field("UF"));
      await user.type(field("UF"), "SP");
      await user.clear(field("CEP"));
      await user.type(field("CEP"), "01400000");
      await user.click(screen.getByRole("button", { name: "Salvar" }));

      await vi.waitFor(() => expect(saveProperty).toHaveBeenCalledOnce());
      expect(vi.mocked(saveProperty).mock.calls[0]?.[1]).toMatchObject({ id: "p1", state: "SP", zipCode: "01400000" });
    });

    it("erro numa chave que o formulário não tem: Alert no topo do formulário", () => {
      open("p1", { properties: [flores], drafts: [rejected({ "": ["Corpo ilegível."] })] });

      expect(screen.getByRole("alert").textContent).toBe("O servidor recusou este cadastro. Corrija e salve de novo.");
    });
  });

  describe("conflito (412 com colisão)", () => {
    const conflicted: DraftRecord = {
      id: "p1",
      entity: "property",
      data: { ...flores, number: "121" },
      status: "conflict",
      errors: {},
      conflict: {
        current: { ...flores, version: "AAAAAAAAB9U=", number: "122" },
        base: flores,
        collisions: [],
      },
      updatedAt: "2026-10-27T18:02:00.000Z",
    };

    it("o aviso e 'Resolver conflito' acima do formulário, com o que foi salvo aqui", () => {
      open("p1", { properties: [flores], drafts: [conflicted] });

      expect(screen.getByText("Este imóvel foi alterado em outro aparelho")).toBeDefined();
      expect(screen.getByRole("link", { name: "Resolver conflito" }).getAttribute("href")).toBe(
        "/properties/conflict?id=p1",
      );
      expect(field("Número").value).toBe("121");
    });

    it("salvar leva ao ConflictResolver, não à lista", async () => {
      const user = userEvent.setup();
      open("p1", { properties: [flores], drafts: [conflicted] });

      await user.clear(field("Número"));
      await user.type(field("Número"), "122");
      await user.click(screen.getByRole("button", { name: "Salvar" }));

      await vi.waitFor(() => expect(saveProperty).toHaveBeenCalledOnce());
      expect(vi.mocked(saveProperty).mock.calls[0]?.[1]).toMatchObject({ id: "p1", number: "122" });
      expect(navigation.push).toHaveBeenCalledWith("/properties/conflict?id=p1");
    });
  });

  describe("id que não está no aparelho (leitura por id)", () => {
    it("busca no servidor e, enquanto busca, não mostra aviso nem formulário", () => {
      vi.mocked(fetchProperty).mockReturnValue(new Promise(() => {}));
      open("nao-existe");

      expect(vi.mocked(fetchProperty)).toHaveBeenCalledWith(local.value.store, "nao-existe");
      expect(heading().textContent).toBe("Imóvel");
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("o que já está no aparelho não é buscado", () => {
      open(null);

      expect(vi.mocked(fetchProperty)).not.toHaveBeenCalled();
    });

    it("404: não encontrado, com a volta para a lista", async () => {
      open("nao-existe");

      expect(await screen.findByText("Este imóvel não existe ou foi excluído.")).toBeDefined();
      expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe("/properties");
      expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("sem rede: explica que é preciso abrir uma vez com internet", async () => {
      vi.mocked(fetchProperty).mockResolvedValue("offline");
      open("nao-existe");

      expect(
        await screen.findByText(
          "Este imóvel ainda não está neste aparelho. Abra-o uma vez com internet para trabalhar nele offline.",
        ),
      ).toBeDefined();
      expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    });

    it("falha do servidor: Tentar de novo busca outra vez", async () => {
      const user = userEvent.setup();
      vi.mocked(fetchProperty).mockResolvedValue("failed");
      open("nao-existe");

      await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));

      expect(screen.getByText("Não foi possível buscar este imóvel agora.")).toBeDefined();
      await vi.waitFor(() => expect(vi.mocked(fetchProperty)).toHaveBeenCalledTimes(2));
    });
  });

  // #176: o histórico do imóvel, numa linha do tempo; abas abaixo de 1280 px, Card ao lado do formulário a partir dele.
  describe("histórico do imóvel", () => {
    const summary = (id: string, over: Partial<InspectionSummary> = {}): InspectionSummary => ({
      id,
      version: "AAAAAAAAB9M=",
      propertyId: "p1",
      kind: "moveIn",
      status: "completed",
      startedAt: "2025-02-03T12:00:00.000Z",
      evaluated: 29,
      items: 29,
      ...over,
    });
    const BACK = encodeURIComponent("/properties/edit?id=p1&tab=vistorias");

    function wide(matches: boolean) {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: matches && query === "(min-width: 1280px)",
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    }

    function withHistory(tab?: string) {
      inspections.summaries = [
        summary("entrada"),
        summary("saida", { kind: "moveOut", status: "inProgress", startedAt: "2026-10-19T12:00:00.000Z", evaluated: 12 }),
        summary("em-conflito", { startedAt: "2024-05-01T12:00:00.000Z" }),
        summary("de-outro", { propertyId: "p2", startedAt: "2026-11-01T12:00:00.000Z" }),
      ];
      const conflictDraft: DraftRecord = {
        id: "em-conflito",
        entity: "inspection",
        data: { ...summary("em-conflito", { startedAt: "2024-05-01T12:00:00.000Z" }), rooms: [] },
        status: "conflict",
        errors: {},
        updatedAt: "2026-10-26T13:10:00.000Z",
      };
      open("p1", { properties: [flores], drafts: [conflictDraft], states: new Map([["saida", "local" as const]]) }, tab);
    }

    it("abaixo de 1280 px: abas Dados | Vistorias · N, Dados aberta por padrão, e a troca grava a aba na URL", async () => {
      const user = userEvent.setup();
      withHistory();

      expect(screen.getByRole("tab", { name: "Dados" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "Vistorias · 3" })).toBeDefined();
      expect(field("Rua").value).toBe("Rua das Flores");
      expect(screen.queryByRole("list", { name: "Histórico do imóvel" })).toBeNull();

      await user.click(screen.getByRole("tab", { name: "Vistorias · 3" }));

      expect(navigation.replace).toHaveBeenCalledWith("/properties/edit?id=p1&tab=vistorias", { scroll: false });
    });

    it("aba Vistorias: só as do imóvel, da mais nova para a mais antiga, com o clique certo em cada estado", () => {
      withHistory("vistorias");

      const list = screen.getByRole("list", { name: "Histórico do imóvel" });
      const links = within(list).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual([
        "Saída · Em andamentoIniciada em 19/10/2026 · 12 de 29 itensSalvo no aparelho",
        "Entrada · ConcluídaIniciada em 03/02/2025",
        "Entrada · ConcluídaIniciada em 01/05/2024Conflito",
      ]);
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        // Em andamento: a tela de campo, que volta para cá.
        `/inspections/edit?id=saida&voltar=${BACK}`,
        // Concluída e confirmada: o laudo, que volta para cá.
        `/inspections/report?id=entrada&voltar=${BACK}`,
        // Em conflito: o ConflictResolver.
        "/inspections/conflict?id=em-conflito",
      ]);
      expect(screen.getByText("3 vistorias")).toBeDefined();
      expect(screen.getByRole("link", { name: "Nova vistoria" }).getAttribute("href")).toBe(
        "/inspections/new?propertyId=p1",
      );
    });

    it("aba Vistorias sem vistoria: o EmptyState com Nova vistoria", () => {
      open("p1", { properties: [flores] }, "vistorias");

      expect(screen.getByRole("tab", { name: "Vistorias · 0" })).toBeDefined();
      expect(screen.getByText("Nenhuma vistoria deste imóvel")).toBeDefined();
      expect(screen.getByRole("link", { name: "Nova vistoria" }).getAttribute("href")).toBe(
        "/inspections/new?propertyId=p1",
      );
    });

    it("a partir de 1280 px: sem abas, o formulário e o Card \"Histórico do imóvel\" lado a lado", () => {
      wide(true);
      withHistory();

      expect(screen.queryByRole("tab")).toBeNull();
      expect(field("Rua").value).toBe("Rua das Flores");
      expect(screen.getByRole("heading", { name: "Histórico do imóvel" })).toBeDefined();
      expect(screen.getByText("3 vistorias")).toBeDefined();
      expect(within(screen.getByRole("list", { name: "Histórico do imóvel" })).getAllByRole("listitem")).toHaveLength(3);
      expect(screen.getByRole("link", { name: "Nova vistoria" }).getAttribute("href")).toBe(
        "/inspections/new?propertyId=p1",
      );
    });

    it("imóvel novo: sem abas nem histórico, também a partir de 1280 px", () => {
      wide(true);
      open(null);

      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.queryByText("Histórico do imóvel")).toBeNull();
    });
  });
});
