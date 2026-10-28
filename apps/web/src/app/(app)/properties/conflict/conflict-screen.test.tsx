import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";
import { resolvePropertyConflict } from "@/features/properties/services/properties.sync";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "../../app-shell";
import { PropertyConflictScreen } from "./conflict-screen";

// /properties/conflict?id= dentro do shell (ConflictResolver 32:1787, ADR 0038), com o banco local simulado no hook e o
// envio da resolução espionado.

const navigation = vi.hoisted(() => ({
  search: "",
  back: vi.fn<() => void>(),
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/properties/conflict",
  useRouter: () => ({ back: navigation.back, push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => [] }));

const EMPTY = {
  store: { properties: {}, drafts: {}, outbox: {} },
  ready: true,
  clients: [] as ClientRecord[],
  properties: [] as PropertyRecord[],
  drafts: [] as DraftRecord[],
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/properties/services/properties.sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/properties/services/properties.sync")>()),
  resolvePropertyConflict: vi.fn<() => Promise<void>>(async () => {}),
}));

const client = (id: string, name: string): ClientRecord => ({
  id,
  version: "A",
  name,
  document: null,
  email: null,
  phone: null,
});

const apto: PropertyRecord = {
  id: "p1",
  version: "A",
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

// Aqui, o cliente, o tipo e o CEP; no outro aparelho, o cliente, o tipo e as observações.
const mine: PropertyRecord = { ...apto, clientId: "c2", type: "commercial", zipCode: "01400001" };
const theirs = { ...apto, version: "B", clientId: "c3", type: "house", notes: "Chave na portaria" };

const conflicted: DraftRecord = {
  id: "p1",
  entity: "property",
  data: mine,
  status: "conflict",
  errors: {},
  conflict: { current: { ...theirs, updatedAt: "2026-10-27T17:58:00+00:00" }, base: apto, collisions: [] },
  updatedAt: "2026-10-27T18:02:00.000Z",
};

function open(over: Partial<typeof EMPTY> = {}, id = "p1") {
  navigation.search = `?id=${id}`;
  local.value = {
    ...EMPTY,
    clients: [client("c1", "Imobiliária Lar"), client("c2", "Maria Souza")],
    properties: [apto],
    drafts: [conflicted],
    ...over,
  };
  return render(
    <AppShell>
      <PropertyConflictScreen />
    </AppShell>,
  );
}

afterEach(() => {
  vi.mocked(resolvePropertyConflict).mockClear();
  navigation.back.mockReset();
  resetSyncStatus();
  resetSession();
});

describe("PropertyConflictScreen", () => {
  it("cliente pelo nome e tipo por extenso, na ordem do formulário; o que só um lado mudou não aparece", async () => {
    open();

    expect(await screen.findByRole("heading", { level: 1, name: "Conflito" })).toBeDefined();
    expect(screen.getByText(/^R\. das Flores, 120 · Apto 302\. Ele foi alterado/)).toBeDefined();
    const group = screen.getByRole("region", { name: "Imóvel" });
    const fields = within(group).getAllByRole("radiogroup");
    expect(fields.map((field) => field.getAttribute("aria-label"))).toEqual(["Cliente", "Tipo"]);
    const [owner, type] = fields as [HTMLElement, HTMLElement];
    expect(within(group).getByText("Antes: Imobiliária Lar")).toBeDefined();
    expect(within(owner).getByRole("radio", { name: /Neste aparelho.*Maria Souza/ })).toBeDefined();
    expect(within(owner).getByRole("radio", { name: /No servidor.*Cliente fora deste aparelho/ })).toBeDefined();
    expect(within(type).getByRole("radio", { name: /Neste aparelho.*Comercial/ })).toBeDefined();
    expect(within(type).getByRole("radio", { name: /No servidor.*Casa/ })).toBeDefined();
    expect(screen.getByText("Faltam 2 campos")).toBeDefined();
  });

  it("misto: o cliente daqui, o tipo de lá, e o resto mesclado segue junto", async () => {
    const user = userEvent.setup();
    window.history.pushState(null, "", "/properties/conflict?id=p1");
    open();

    await user.click(await screen.findByText("Maria Souza"));
    await user.click(screen.getByText("Casa"));
    await user.click(screen.getByRole("button", { name: "Enviar resolução" }));

    const [, { resolved }] = vi.mocked(resolvePropertyConflict).mock.calls[0]!;
    expect(resolved).toEqual({
      ...apto,
      version: "B",
      clientId: "c2",
      type: "house",
      zipCode: "01400001",
      notes: "Chave na portaria",
    });
    expect(navigation.back).toHaveBeenCalledOnce();
  });

  it("'Voltar' não envia nada", async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Voltar" }));

    expect(resolvePropertyConflict).not.toHaveBeenCalled();
  });

  it("sem conflito para resolver: o aviso e 'Abrir o imóvel'", () => {
    open({ drafts: [] });

    expect(screen.getByText("Este imóvel não tem conflito para resolver.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Abrir o imóvel" }).getAttribute("href")).toBe(
      "/properties/edit?id=p1",
    );
  });
});
