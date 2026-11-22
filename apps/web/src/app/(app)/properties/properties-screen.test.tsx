import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";
import { resizeTo, stubWidth } from "@/shared/viewport.harness";

import { PropertiesScreen } from "./properties-screen";

// O banco local simulado no hook: a tela, os hooks e os componentes são os de verdade.
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

const client = (id: string, name: string): ClientRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  name,
  document: null,
  email: null,
  phone: null,
});

const property = (id: string, over: Partial<PropertyRecord>): PropertyRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  clientId: "c1",
  street: "Rua das Flores",
  number: "120",
  complement: null,
  district: "Jardim Paulista",
  city: "São Paulo",
  state: "SP",
  zipCode: "01400000",
  type: "apartment",
  notes: null,
  ...over,
});

const clients = [client("c1", "Imobiliária Horizonte"), client("c2", "Lar Imóveis")];
const flores = property("p1", { complement: "ap 32" });
const brasil = property("p2", {
  clientId: "c2",
  street: "Av. Brasil",
  number: "1500",
  complement: "sala 4",
  district: "Centro",
  type: "commercial",
});
const porto = property("p3", {
  street: "Rua do Porto",
  number: "12",
  district: "Centro",
  city: "Santos",
  type: "house",
});

function seed(over: Partial<typeof local.value>) {
  local.value = { ...local.value, clients, ...over };
}

const table = () => screen.getByRole("table");
const mobileList = () => screen.getByRole("list");
const addresses = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((row) => (row as HTMLTableRowElement).cells[0]?.textContent);

async function choose(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

// No desktop, a não ser que o teste mude a largura: abaixo de `lg`, só a lista do celular existe (#223).
beforeEach(() => {
  stubWidth(1440);
});

afterEach(() => {
  vi.unstubAllGlobals();
  local.value = {
    store: {},
    ready: true,
    clients: [],
    properties: [],
    drafts: [],
    states: new Map(),
  };
});

describe("PropertiesScreen", () => {
  it("antes de o banco local abrir, não mostra nada (nem o vazio)", () => {
    seed({ ready: false });

    const { container } = render(<PropertiesScreen />);

    expect(container.textContent).toBe("");
  });

  it("vazio: EmptyState com a ação Novo imóvel", () => {
    seed({});

    render(<PropertiesScreen />);

    expect(screen.getByText("Nenhum imóvel ainda")).toBeDefined();
    expect(screen.getByText("Cadastre os imóveis que você vistoria.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Novo imóvel" }).getAttribute("href")).toBe("/properties/edit");
  });

  it("lista em ordem de endereço, com cliente, tipo e cidade; a linha leva à edição", () => {
    seed({ properties: [porto, flores, brasil] });

    render(<PropertiesScreen />);

    const header = within(table()).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(header).toEqual(["Endereço", "Cliente", "Tipo", "Cidade", "Sincronização"]);
    expect(addresses()).toEqual(["Av. Brasil, 1500 · sala 4", "Rua das Flores, 120 · ap 32", "Rua do Porto, 12"]);
    const [first] = within(table()).getAllByRole("row").slice(1) as HTMLTableRowElement[];
    expect([...first!.cells].slice(1, 4).map((cell) => cell.textContent)).toEqual([
      "Lar Imóveis",
      "Comercial",
      "São Paulo/SP",
    ]);
    expect(within(first!).getByRole("link", { name: "Av. Brasil, 1500 · sala 4" }).getAttribute("href")).toBe(
      "/properties/edit?id=p2",
    );
    resizeTo(390);
    const row = within(mobileList()).getByRole("link", { name: /Rua do Porto/ });
    expect(row.textContent).toContain("Imobiliária Horizonte · Casa");
    expect(row.textContent).toContain("Santos/SP");
    expect(screen.getByRole("link", { name: "Novo imóvel" }).getAttribute("href")).toBe("/properties/edit");
  });

  it("criado offline: 'Salvo no aparelho'; recusado: 'Correção necessária'; sincronizado: sem badge", () => {
    seed({
      properties: [flores, brasil],
      drafts: [
        {
          id: "p3",
          entity: "property",
          data: porto,
          status: "rejected",
          errors: { clientId: ["Cliente não encontrado."] },
          updatedAt: "2026-10-22T12:00:00.000Z",
        },
      ],
      states: new Map([["p1", "local"]]),
    });

    render(<PropertiesScreen />);

    const rows = within(table()).getAllByRole("row").slice(1) as HTMLTableRowElement[];
    expect(rows.map((row) => row.cells[4]?.textContent)).toEqual([
      "",
      "Salvo no aparelho",
      "Correção necessária",
    ]);
  });

  it("busca local por endereço, bairro e cidade; sem resultado, o EmptyState da busca", async () => {
    const user = userEvent.setup();
    seed({ properties: [porto, flores, brasil] });
    render(<PropertiesScreen />);
    const search = screen.getByRole("searchbox", { name: "Buscar imóveis" });

    await user.type(search, "santos");
    expect(addresses()).toEqual(["Rua do Porto, 12"]);

    await user.clear(search);
    await user.type(search, "centro");
    expect(addresses()).toEqual(["Av. Brasil, 1500 · sala 4", "Rua do Porto, 12"]);

    await user.clear(search);
    await user.type(search, "Rua Augusta");
    expect(screen.getByText("Nenhum imóvel encontrado")).toBeDefined();
    expect(screen.getByText("Confira a busca e os filtros ou cadastre um imóvel novo.")).toBeDefined();
  });

  it("placeholder da busca: completo no desktop, 'Buscar' no celular (Figma 71:2797 e 71:2965)", () => {
    seed({ properties: [flores] });
    stubWidth(390);
    const { unmount } = render(<PropertiesScreen />);
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe("Buscar");
    unmount();

    stubWidth(768);
    render(<PropertiesScreen />);
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe(
      "Buscar por endereço, bairro ou cidade",
    );
  });

  it("filtros por cliente e por tipo, na barra do desktop", async () => {
    const user = userEvent.setup();
    seed({ properties: [porto, flores, brasil] });
    render(<PropertiesScreen />);
    const byClient = screen.getByRole("combobox", { name: "Filtrar por cliente" });
    const byType = screen.getByRole("combobox", { name: "Filtrar por tipo" });
    expect(byClient.textContent).toBe("Cliente: todos");
    expect(byType.textContent).toBe("Tipo: todos");

    await choose(user, byClient, "Imobiliária Horizonte");
    expect(addresses()).toEqual(["Rua das Flores, 120 · ap 32", "Rua do Porto, 12"]);

    await choose(user, byType, "Casa");
    expect(addresses()).toEqual(["Rua do Porto, 12"]);

    await choose(user, byClient, "Todos");
    await choose(user, byType, "Comercial");
    expect(addresses()).toEqual(["Av. Brasil, 1500 · sala 4"]);
  });

  it("celular: 'Filtros' abre o Sheet com os mesmos filtros e conta os ligados", async () => {
    const user = userEvent.setup();
    seed({ properties: [porto, flores, brasil] });
    render(<PropertiesScreen />);

    await user.click(screen.getByRole("button", { name: "Filtros" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtros" });
    await choose(user, within(sheet).getByRole("combobox", { name: "Filtrar por tipo" }), "Apartamento");
    await user.click(within(sheet).getByRole("button", { name: "Fechar" }));

    expect(screen.getByRole("button", { name: "Filtros · 1" })).toBeDefined();
    expect(addresses()).toEqual(["Rua das Flores, 120 · ap 32"]);
  });
  describe("lista longa (#223)", () => {
    // 60 imóveis, "Rua A, 1" a "Rua A, 60", na ordem do endereço; os de número par são casas.
    const many = Array.from({ length: 60 }, (_, n) =>
      property(`p${n + 1}`, { street: "Rua A", number: String(n + 1), type: n % 2 ? "house" : "apartment" }),
    );
    // Por seletor: as consultas por role do jsdom ficam lentas com dezenas de linhas.
    const tableLinks = (container: HTMLElement) => container.querySelectorAll("tbody a");
    const mobileLinks = (container: HTMLElement) => container.querySelectorAll("ul a");

    it("monta 50 linhas por vez, e 'Mostrar mais' monta a próxima página até acabar", async () => {
      const user = userEvent.setup();
      seed({ properties: many });
      const { container } = render(<PropertiesScreen />);

      expect(tableLinks(container)).toHaveLength(50);
      expect(tableLinks(container)[49]?.textContent).toBe("Rua A, 50");
      expect(screen.getByText("50 de 60 imóveis")).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Mostrar mais" }));

      expect(tableLinks(container)).toHaveLength(60);
      expect(tableLinks(container)[59]?.textContent).toBe("Rua A, 60");
      expect(screen.getByText("60 imóveis")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Mostrar mais" })).toBeNull();
    });

    it("a busca e os filtros correm sobre todos os imóveis, e mudar um deles volta para a primeira página", async () => {
      const user = userEvent.setup();
      seed({ properties: many });
      const { container } = render(<PropertiesScreen />);
      const search = screen.getByRole("searchbox", { name: "Buscar imóveis" });

      await user.type(search, "Rua A, 59");
      expect([...tableLinks(container)].map((a) => a.textContent)).toEqual(["Rua A, 59"]);
      expect(screen.getByText("1 imóvel")).toBeDefined();

      await user.clear(search);
      await user.click(screen.getByRole("button", { name: "Mostrar mais" }));
      expect(tableLinks(container)).toHaveLength(60);

      // As 30 casas cabem numa página; com a página de volta em 50, todas aparecem, sem "Mostrar mais".
      await choose(user, screen.getByRole("combobox", { name: "Filtrar por tipo" }), "Casa");
      expect(tableLinks(container)).toHaveLength(30);
      expect(tableLinks(container)[29]?.textContent).toBe("Rua A, 60");
      expect(screen.getByText("30 imóveis")).toBeDefined();

      await choose(user, screen.getByRole("combobox", { name: "Filtrar por tipo" }), "Todos");
      expect(tableLinks(container)).toHaveLength(50);
      expect(screen.getByText("50 de 60 imóveis")).toBeDefined();
    });

    it("só a versão da largura existe: a tabela a partir de 1024 px, a lista do celular abaixo, sem recarregar", () => {
      seed({ properties: many });
      stubWidth(1024);
      const { container } = render(<PropertiesScreen />);

      expect(tableLinks(container)).toHaveLength(50);
      expect(mobileLinks(container)).toHaveLength(0);

      resizeTo(1023);
      expect(screen.queryByRole("table")).toBeNull();
      expect(mobileLinks(container)).toHaveLength(50);
      expect(screen.getByRole("button", { name: "Mostrar mais" })).toBeDefined();
    });
  });
});
