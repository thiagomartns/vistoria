import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TemplateRecord } from "@/features/templates/models/template";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { TemplatesScreen } from "./templates-screen";

// O banco local de roteiros simulado no hook: a tela, os hooks e os componentes são os de verdade.
const local = vi.hoisted(() => ({
  value: {
    store: {},
    ready: true,
    templates: [] as TemplateRecord[],
    drafts: [] as DraftRecord[],
    states: new Map<string, RecordSyncState>(),
  },
}));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

const items = (names: string[]) =>
  names.map((name, position) => ({ id: `i-${name}`, name, position }));
const template = (id: string, name: string, rooms: [string, string[]][]): TemplateRecord => ({
  id,
  version: "AAAAAAAAB9M=",
  name,
  rooms: rooms.map(([room, things], position) => ({
    id: `r-${room}`,
    name: room,
    position,
    items: items(things),
  })),
});

const apartamento = template("t1", "Apartamento", [
  ["Sala", ["Piso", "Paredes", "Teto"]],
  ["Cozinha", ["Piso", "Pia"]],
]);
const compacto = template("t2", "Apartamento compacto", [["Quarto", ["Piso"]]]);
const sala = template("t3", "Sala comercial", []);

function seed(over: Partial<typeof local.value>) {
  local.value = { ...local.value, ...over };
}

afterEach(() => {
  local.value = { store: {}, ready: true, templates: [], drafts: [], states: new Map() };
  vi.unstubAllGlobals();
});

describe("TemplatesScreen", () => {
  it("nada enquanto o banco local abre", () => {
    seed({ ready: false, templates: [apartamento] });
    const { container } = render(<TemplatesScreen />);

    expect(container.textContent).toBe("");
  });

  it("vazio: o EmptyState sem ação, com 'Novo roteiro' acima", () => {
    render(<TemplatesScreen />);

    expect(screen.getByText("Nenhum roteiro ainda")).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Novo roteiro" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Novo roteiro" }).getAttribute("href")).toBe(
      "/templates/edit",
    );
  });

  it("desktop: nome, ambientes e itens por linha, em ordem de nome; o SyncBadge só na pendência", () => {
    seed({ templates: [sala, compacto, apartamento], states: new Map([["t2", "local"]]) });
    render(<TemplatesScreen />);

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Apartamento", "2", "5", ""],
      ["Apartamento compacto", "1", "1", "Salvo no aparelho"],
      ["Sala comercial", "0", "0", ""],
    ]);
    expect(within(rows[0]!).getByRole("link", { name: "Apartamento" }).getAttribute("href")).toBe(
      "/templates/edit?id=t1",
    );
  });

  it("celular: a ListRow com as contagens", () => {
    seed({ templates: [apartamento, compacto] });
    render(<TemplatesScreen />);

    const row = screen.getAllByRole("link", { name: /Apartamento compacto/ }).at(-1)!;
    expect(row.getAttribute("href")).toBe("/templates/edit?id=t2");
    expect(within(row).getByText("1 ambiente · 1 item")).toBeDefined();
    expect(screen.getByText("2 ambientes · 5 itens")).toBeDefined();
  });

  it("a criação recusada aparece pelo rascunho, com 'Correção necessária'", () => {
    seed({
      drafts: [
        {
          id: "t9",
          entity: "template",
          data: { id: "t9", version: null, name: "Casa térrea", rooms: [] },
          status: "rejected",
          errors: { name: ["O nome precisa ter de 1 a 60 caracteres."] },
          updatedAt: "2026-11-12T12:00:00.000Z",
        },
      ],
    });
    render(<TemplatesScreen />);

    const row = within(screen.getByRole("table")).getByRole("row", { name: /Casa térrea/ });
    expect(within(row).getByText("Correção necessária")).toBeDefined();
  });

  it("busca local pelo nome, sem acento; sem resultado, o EmptyState da busca", async () => {
    const user = userEvent.setup();
    seed({ templates: [apartamento, compacto, sala] });
    render(<TemplatesScreen />);

    await user.type(screen.getByRole("searchbox", { name: "Buscar roteiros" }), "COMPACTO");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "galpão");
    expect(screen.getByText("Nenhum roteiro encontrado")).toBeDefined();
  });

  it("o placeholder da busca é curto no celular", () => {
    seed({ templates: [apartamento] });
    const { unmount } = render(<TemplatesScreen />);
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe("Buscar");
    unmount();

    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    render(<TemplatesScreen />);
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe("Buscar roteiro");
  });
});
