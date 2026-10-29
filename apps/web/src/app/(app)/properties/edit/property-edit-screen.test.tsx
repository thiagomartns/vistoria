import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
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
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/properties/edit",
  useRouter: () => ({ push: navigation.push, replace: vi.fn<() => void>() }),
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
  },
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

function open(id: string | null, over: Partial<typeof local.value> = {}) {
  navigation.search = id ? `?id=${id}` : "";
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
  };
  navigation.push.mockReset();
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
});
