import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { ClientsScreen } from "./clients-screen";

// O banco local de clients simulado no hook: a tela, os hooks e os componentes são os de verdade.
const local = vi.hoisted(() => ({
  value: {
    store: {},
    ready: true,
    clients: [] as ClientRecord[],
    drafts: [] as DraftRecord[],
    states: new Map<string, RecordSyncState>(),
  },
}));

vi.mock("@/features/clients/hooks/useClientsStore", () => ({
  useClientsStore: () => local.value,
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
  phone: "(11) 3456-7890",
});
const maria = client("c2", "Maria Souza", {
  version: null,
  document: "52998224725",
  phone: "(11) 98765-4321",
});

function seed(over: Partial<typeof local.value>) {
  local.value = { ...local.value, ...over };
}

const table = () => screen.getByRole("table");
const mobileList = () => screen.getByRole("list");

afterEach(() => {
  local.value = { store: {}, ready: true, clients: [], drafts: [], states: new Map() };
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

  it("lista em ordem alfabética, documento com máscara, linha leva à edição", () => {
    seed({ clients: [maria, horizonte] });

    render(<ClientsScreen />);

    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => (row as HTMLTableRowElement).cells[0]?.textContent)).toEqual([
      "Imobiliária Horizonte",
      "Maria Souza",
    ]);
    expect(rows[0]?.textContent).toContain("11.222.333/0001-81");
    expect(within(rows[1]!).getByRole("link", { name: "Maria Souza" }).getAttribute("href")).toBe(
      "/clients/edit?id=c2",
    );
    expect(within(mobileList()).getByRole("link", { name: /Maria Souza/ }).textContent).toContain(
      "529.982.247-25 · (11) 98765-4321",
    );
  });

  it("criado offline: 'Salvo no aparelho' na linha; enviado, o badge some (silêncio no caminho feliz)", () => {
    seed({ clients: [horizonte, maria], states: new Map([["c2", "local"]]) });

    const { rerender } = render(<ClientsScreen />);

    const mariaRow = () => within(table()).getAllByRole("row")[2]!;
    expect(within(mariaRow()).getByText("Salvo no aparelho")).toBeDefined();
    expect(within(table()).getAllByRole("row")[1]?.textContent).not.toContain("Sincronizado");
    expect(within(mobileList()).getByText("Salvo no aparelho")).toBeDefined();

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

  it("busca local por nome, documento e e-mail; sem resultado, o EmptyState da busca", async () => {
    seed({ clients: [horizonte, maria] });
    const user = userEvent.setup();
    render(<ClientsScreen />);
    const search = screen.getByRole("searchbox", { name: "Buscar clientes" });

    await user.type(search, "529.982");
    expect(within(table()).getAllByRole("row")).toHaveLength(2);
    expect(table().textContent).toContain("Maria Souza");

    await user.clear(search);
    await user.type(search, "horizonte.com");
    expect(table().textContent).toContain("Imobiliária Horizonte");
    expect(table().textContent).not.toContain("Maria Souza");

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByRole("heading", { name: "Nenhum cliente encontrado" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Novo cliente" })).toBeDefined();
  });
});
