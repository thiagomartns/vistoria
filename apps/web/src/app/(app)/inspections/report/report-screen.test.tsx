import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import type { PropertyRecord } from "@/features/properties/models/property";

import { ReportScreen } from "./report-screen";

// A tela do laudo (Figma 177:16524), estados 1, 2, 4, 5 e 6, com o banco local simulado no hook. A impressão (estado 3:
// sem o shell, A4, um ambiente por página) é CSS, provada pelo spike:outbox no Chromium com o `page.pdf`.

const navigation = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inspections/report",
  useRouter: () => ({ push: vi.fn<() => void>(), replace: vi.fn<() => void>() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const local = vi.hoisted(() => ({
  value: {
    store: {},
    ready: true,
    clients: [] as ClientRecord[],
    properties: [] as PropertyRecord[],
    inspections: [] as InspectionRecord[],
  },
}));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/inspections/hooks/useInspectionRecord", () => ({
  useInspectionRecord: (_store: unknown, id: string | null) => ({
    record: local.value.inspections.find((inspection) => inspection.id === id),
    ready: true,
  }),
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

const entrada: InspectionRecord = {
  id: "i1",
  version: "AAAAAAAAB9E=",
  propertyId: "p1",
  kind: "moveIn",
  status: "completed",
  startedAt: new Date(2026, 9, 19, 9, 12).toISOString(),
  completedAt: new Date(2026, 9, 19, 11, 47).toISOString(),
  completedBy: { id: "u1", name: "Thiago Martins" },
  generalNotes: "Imóvel entregue limpo.",
  rooms: [
    {
      id: "r1",
      name: "Sala",
      position: 0,
      notes: null,
      items: [
        { id: "t1", name: "Piso", position: 0, condition: "good", notes: null },
        { id: "t2", name: "Paredes", position: 1, condition: "fair", notes: "Furo de bucha" },
      ],
    },
  ],
};

const saida: InspectionRecord = {
  ...entrada,
  id: "i2",
  kind: "moveOut",
  referenceInspectionId: "i1",
  rooms: [
    {
      id: "r2",
      name: "Sala",
      position: 0,
      notes: null,
      items: [
        {
          id: "t3",
          name: "Paredes",
          position: 0,
          condition: "poor",
          notes: "Mancha de umidade",
          referenceCondition: "fair",
          referenceNotes: "Furo de bucha",
        },
      ],
    },
  ],
};

function open(id: string, inspections: InspectionRecord[] = [entrada, saida]) {
  navigation.search = `id=${id}`;
  local.value = { ...local.value, clients: [lar], properties: [apto], inspections };
  return render(<ReportScreen />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportScreen", () => {
  it("estado 1 (entrada): a folha com a logo, quem concluiu, os itens e o botão de imprimir", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    open("i1");

    const sheet = screen.getByRole("article", { name: "Laudo de vistoria de entrada" });
    expect(within(sheet).getByText("Avis")).toBeDefined();
    expect(
      within(sheet).getByText(
        "Concluída por Thiago Martins em 19/10/2026 às 11:47 (registrada pelo servidor)",
      ),
    ).toBeDefined();
    const sala = within(sheet).getByRole("region", { name: "1. Sala" });
    expect(within(sala).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Item",
      "Condição",
      "Observação",
    ]);
    const paredes = within(sala).getByRole("row", { name: /Paredes/ });
    expect(within(paredes).getAllByRole("cell").map((td) => td.textContent)).toEqual([
      "Paredes",
      "Regular",
      "Furo de bucha",
    ]);
    // No celular, a observação também abaixo da tabela.
    expect(within(sala).getByText("Paredes: Furo de bucha")).toBeDefined();
    expect(within(sheet).getByText("Imóvel entregue limpo.")).toBeDefined();

    await userEvent.setup().click(screen.getByRole("button", { name: "Imprimir ou salvar PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("estado 2 (saída): a coluna Entrada com a condição e a observação da entrada de cada item", () => {
    open("i2");

    const sheet = screen.getByRole("article", { name: "Laudo de vistoria de saída" });
    const sala = within(sheet).getByRole("region", { name: "1. Sala" });
    expect(within(sala).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Item",
      "Entrada",
      "Saída",
      "Observação",
    ]);
    const paredes = within(sala).getByRole("row", { name: /Paredes/ });
    expect(within(paredes).getAllByRole("cell").map((td) => td.textContent)).toEqual([
      "Paredes",
      "Regular · Furo de bucha",
      "Ruim",
      "Mancha de umidade",
    ]);
    expect(
      within(sala).getByText("Paredes · Entrada: Furo de bucha · Saída: Mancha de umidade"),
    ).toBeDefined();
  });

  it("estado 4: com a conclusão na fila, o aviso e nenhum laudo", () => {
    const { completedAt: _completedAt, completedBy: _completedBy, ...queued } = entrada;
    open("i1", [queued]);

    expect(screen.getByRole("status").textContent).toContain(
      "O laudo fica disponível quando a conclusão for enviada",
    );
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("button", { name: "Imprimir ou salvar PDF" })).toBeNull();
  });

  it("estado 5: vistoria em andamento não mostra o laudo, e leva à tela de campo", () => {
    open("i1", [{ ...entrada, status: "inProgress", completedAt: undefined }]);

    expect(screen.getByRole("status").textContent).toContain("Esta vistoria ainda não foi concluída");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("link", { name: "Abrir a vistoria" }).getAttribute("href")).toBe(
      "/inspections/edit?id=i1",
    );
  });

  it("estado 6: vistoria que o aparelho não tem, e o caminho para a lista", () => {
    open("nenhuma");

    expect(screen.getByRole("status").textContent).toContain("Vistoria não encontrada");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("link", { name: "Ver as vistorias" }).getAttribute("href")).toBe(
      "/inspections",
    );
  });
});
