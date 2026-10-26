import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import { saveInspection } from "@/features/inspections/services/inspections.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import { resetSession } from "@/shared/auth/session";
import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "../../app-shell";
import { NewInspectionScreen } from "./new-inspection-screen";

// /inspections/new (wireframe 68:1644), com o banco local simulado no hook e o saveInspection espionado.

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
  },
}));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/inspections/services/inspections.sync", () => ({
  saveInspection: vi.fn<() => string>(() => "nova"),
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

function open(properties: PropertyRecord[]) {
  local.value = { ...local.value, clients: [lar], properties };
  return render(
    <AppShell>
      <NewInspectionScreen />
    </AppShell>,
  );
}

afterEach(() => {
  navigation.push.mockReset();
  vi.mocked(saveInspection).mockClear();
  resetSyncStatus();
  resetSession();
});

describe("NewInspectionScreen", () => {
  it("Tipo com Entrada marcada e Saída desabilitada; Roteiro padrão; Voltar e Cancelar para a lista", () => {
    open([property("p1", "Rua das Flores")]);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nova vistoria");
    expect(screen.getByRole("radio", { name: "Entrada" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect((screen.getByRole("radio", { name: "Saída" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("A saída chega numa próxima versão.")).toBeDefined();
    expect(screen.getByLabelText("Roteiro").textContent).toBe(
      "Roteiro padrão · 5 ambientes, 29 itens",
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

  it("escolher o imóvel e começar: cria a entrada pelo roteiro fixo e abre a tela de campo", async () => {
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
});
