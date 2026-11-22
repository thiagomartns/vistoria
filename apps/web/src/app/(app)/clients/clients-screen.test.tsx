import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";
import { resizeTo, stubWidth } from "@/shared/viewport.harness";

import { ClientsScreen } from "./clients-screen";

// O banco local de clients simulado no hook: a tela, os hooks e os componentes são os de verdade.
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

const client = (id: string, name: string, over: Partial<ClientRecord> = {}): ClientRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  name,
  document: null,
  email: null,
  phone: null,
  ...over,
});

const horizonte = client("c1", "Imobiliária Horizonte", {
  document: "11222333000181",
  email: "contato@horizonte.com.br",
  phone: "1134567890",
});
const maria = client("c2", "Maria Souza", {
  version: null,
  document: "52998224725",
  phone: "11987654321",
});

function seed(over: Partial<typeof local.value>) {
  local.value = { ...local.value, ...over };
}

const table = () => screen.getByRole("table");
const mobileList = () => screen.getByRole("list");

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

describe("ClientsScreen", () => {
  it("antes de o banco local abrir, não mostra nada (nem o vazio)", () => {
    seed({ ready: false });

    const { container } = render(<ClientsScreen />);

    expect(container.textContent).toBe("");
  });

  it("vazio: EmptyState com a ação Novo cliente", () => {
    render(<ClientsScreen />);

    expect(screen.getByRole("heading", { name: "Nenhum cliente ainda" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Novo cliente" }).getAttribute("href")).toBe(
      "/clients/edit",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lista em ordem alfabética, documento e telefone com máscara, linha leva à edição", () => {
    seed({ clients: [maria, horizonte] });

    render(<ClientsScreen />);

    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => (row as HTMLTableRowElement).cells[0]?.textContent)).toEqual([
      "Imobiliária Horizonte",
      "Maria Souza",
    ]);
    expect(rows[0]?.textContent).toContain("11.222.333/0001-81");
    expect(rows[0]?.textContent).toContain("(11) 3456-7890");
    expect(rows[1]?.textContent).toContain("(11) 98765-4321");
    expect(within(rows[1]!).getByRole("link", { name: "Maria Souza" }).getAttribute("href")).toBe(
      "/clients/edit?id=c2",
    );
    resizeTo(390);
    expect(within(mobileList()).getByRole("link", { name: /Maria Souza/ }).textContent).toContain(
      "529.982.247-25 · (11) 98765-4321",
    );
  });

  it("Imóveis: quantos imóveis do cliente estão no aparelho, na coluna e na meta do celular", () => {
    const property = (id: string, clientId: string) => ({ id, clientId }) as PropertyRecord;
    seed({
      clients: [maria, horizonte],
      properties: [property("p1", "c1"), property("p2", "c1"), property("p3", "c2")],
    });

    render(<ClientsScreen />);

    const header = within(table()).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(header).toEqual(["Nome", "CPF ou CNPJ", "E-mail", "Telefone", "Imóveis", "Sincronização"]);
    const rows = within(table()).getAllByRole("row").slice(1) as HTMLTableRowElement[];
    expect(rows.map((row) => row.cells[4]?.textContent)).toEqual(["2", "1"]);
    resizeTo(390);
    const links = within(mobileList()).getAllByRole("link");
    expect(links[0]?.textContent).toContain("2 imóveis");
    expect(links[1]?.textContent).toContain("1 imóvel");
  });

  it("sem imóvel, a meta do celular fica vazia e a coluna mostra 0", () => {
    seed({ clients: [maria] });

    render(<ClientsScreen />);

    const [row] = within(table()).getAllByRole("row").slice(1) as HTMLTableRowElement[];
    expect(row?.cells[4]?.textContent).toBe("0");
    resizeTo(390);
    expect(within(mobileList()).getByRole("link").textContent).not.toContain("imóve");
  });

  it("criado offline: 'Salvo no aparelho' na linha; enviado, o badge some (silêncio no caminho feliz)", () => {
    seed({ clients: [horizonte, maria], states: new Map([["c2", "local"]]) });

    const { rerender } = render(<ClientsScreen />);

    const mariaRow = () => within(table()).getAllByRole("row")[2]!;
    expect(within(mariaRow()).getByText("Salvo no aparelho")).toBeDefined();
    expect(within(table()).getAllByRole("row")[1]?.textContent).not.toContain("Sincronizado");
    resizeTo(390);
    expect(within(mobileList()).getByText("Salvo no aparelho")).toBeDefined();
    resizeTo(1440);

    seed({ states: new Map([["c2", "enviando"]]) });
    rerender(<ClientsScreen />);
    expect(within(mariaRow()).getByText("Enviando")).toBeDefined();

    seed({ clients: [horizonte, { ...maria, version: "AAAAAAAAB9Q=" }], states: new Map() });
    rerender(<ClientsScreen />);
    expect(within(mariaRow()).queryByText("Salvo no aparelho")).toBeNull();
    expect(within(mariaRow()).queryByText("Sincronizado")).toBeNull();
  });

  it("recusado pelo servidor: a linha fica, com 'Correção necessária'", () => {
    const gama = client("c3", "Gama", { version: null });
    seed({
      clients: [horizonte],
      drafts: [
        {
          id: "c3",
          entity: "client",
          data: gama,
          status: "rejected",
          errors: { name: ["x"] },
          updatedAt: "2026-10-22T12:00:00.000Z",
        },
      ],
    });

    render(<ClientsScreen />);

    const gamaRow = within(table()).getAllByRole("row")[1]!;
    expect(gamaRow.textContent).toContain("Gama");
    expect(within(gamaRow).getByText("Correção necessária")).toBeDefined();
  });

  it("busca local por nome, documento, telefone e e-mail; sem resultado, o EmptyState da busca", async () => {
    seed({ clients: [horizonte, maria] });
    const user = userEvent.setup();
    render(<ClientsScreen />);
    const search = screen.getByRole("searchbox", { name: "Buscar clientes" });

    await user.type(search, "529.982");
    expect(within(table()).getAllByRole("row")).toHaveLength(2);
    expect(table().textContent).toContain("Maria Souza");

    await user.clear(search);
    await user.type(search, "(11) 98765");
    expect(table().textContent).toContain("Maria Souza");
    expect(table().textContent).not.toContain("Imobiliária Horizonte");

    await user.clear(search);
    await user.type(search, "34567890");
    expect(table().textContent).toContain("Imobiliária Horizonte");
    expect(table().textContent).not.toContain("Maria Souza");

    await user.clear(search);
    await user.type(search, "horizonte.com");
    expect(table().textContent).toContain("Imobiliária Horizonte");
    expect(table().textContent).not.toContain("Maria Souza");

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByRole("heading", { name: "Nenhum cliente encontrado" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Novo cliente" })).toBeDefined();
  });
  describe("lista longa (#223)", () => {
    // 60 clients, "Cliente 00" a "Cliente 59", na ordem alfabética.
    const many = Array.from({ length: 60 }, (_, n) => client(`c${n}`, `Cliente ${String(n).padStart(2, "0")}`));
    // Por seletor: as consultas por role do jsdom ficam lentas com dezenas de linhas.
    const tableLinks = (container: HTMLElement) => container.querySelectorAll("tbody a");
    const mobileLinks = (container: HTMLElement) => container.querySelectorAll("ul a");

    it("monta 50 linhas por vez, e 'Mostrar mais' monta a próxima página até acabar", async () => {
      const user = userEvent.setup();
      seed({ clients: many });
      const { container } = render(<ClientsScreen />);

      expect(tableLinks(container)).toHaveLength(50);
      expect(tableLinks(container)[49]?.textContent).toBe("Cliente 49");
      expect(screen.getByText("50 de 60 clientes")).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Mostrar mais" }));

      expect(tableLinks(container)).toHaveLength(60);
      expect(tableLinks(container)[59]?.textContent).toBe("Cliente 59");
      expect(screen.getByText("60 clientes")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Mostrar mais" })).toBeNull();
    });

    it("a busca corre sobre todos os clients, não só os montados, e volta para a primeira página", async () => {
      const user = userEvent.setup();
      seed({ clients: many });
      const { container } = render(<ClientsScreen />);
      const search = screen.getByRole("searchbox", { name: "Buscar clientes" });

      await user.type(search, "Cliente 59");
      expect([...tableLinks(container)].map((a) => a.textContent)).toEqual(["Cliente 59"]);
      expect(screen.getByText("1 cliente")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Mostrar mais" })).toBeNull();

      await user.clear(search);
      await user.click(screen.getByRole("button", { name: "Mostrar mais" }));
      expect(tableLinks(container)).toHaveLength(60);

      await user.type(search, "cliente");
      expect(tableLinks(container)).toHaveLength(50);
      expect(screen.getByText("50 de 60 clientes")).toBeDefined();
    });

    it("só a versão da largura existe: a tabela a partir de 1024 px, a lista do celular abaixo, sem recarregar", () => {
      seed({ clients: many });
      stubWidth(1024);
      const { container } = render(<ClientsScreen />);

      expect(tableLinks(container)).toHaveLength(50);
      expect(mobileLinks(container)).toHaveLength(0);

      resizeTo(1023);
      expect(screen.queryByRole("table")).toBeNull();
      expect(mobileLinks(container)).toHaveLength(50);
      expect(screen.getByRole("button", { name: "Mostrar mais" })).toBeDefined();
    });
  });
});
