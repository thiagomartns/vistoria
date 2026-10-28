import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import { resolveInspectionConflict } from "@/features/inspections/services/inspections.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "../../app-shell";
import { ConflictScreen } from "./conflict-screen";

// /inspections/conflict?id= dentro do shell (wireframe 69:2632, ConflictResolver 32:1787), com o banco local simulado
// no hook e o envio da resolução espionado.

const navigation = vi.hoisted(() => ({
  search: "",
  back: vi.fn<() => void>(),
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inspections/conflict",
  useRouter: () => ({ back: navigation.back, push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => [] }));

const EMPTY = {
  store: { inspections: {}, drafts: {}, outbox: {} },
  ready: true,
  clients: [] as ClientRecord[],
  properties: [] as PropertyRecord[],
  inspections: [] as InspectionRecord[],
  drafts: [] as DraftRecord[],
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/inspections/services/inspections.sync", () => ({
  resolveInspectionConflict: vi.fn<() => Promise<void>>(async () => {}),
}));

const lar: ClientRecord = {
  id: "c1",
  version: "A",
  name: "Imobiliária Lar",
  document: null,
  email: null,
  phone: null,
};

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

const vistoria: InspectionRecord = {
  id: "i1",
  version: "V1",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: "2026-10-19T12:12:00.000Z",
  generalNotes: null,
  rooms: [
    {
      id: "r1",
      name: "Cozinha",
      position: 0,
      notes: null,
      items: [
        { id: "t1", name: "Piso", position: 0, condition: "good", notes: null },
        { id: "t2", name: "Paredes", position: 1, condition: "fair", notes: null },
      ],
    },
  ],
};

function edited(change: (draft: InspectionRecord) => void) {
  const draft = structuredClone(vistoria);
  change(draft);
  return draft;
}

// Aqui, Paredes ficou Ruim e o Piso ganhou uma observação; no outro aparelho, Paredes ficou Ausente.
const mine = edited((v) => {
  v.rooms[0]!.items[1]!.condition = "poor";
  v.rooms[0]!.items[0]!.notes = "Trincado.";
});
const theirs = edited((v) => {
  v.rooms[0]!.items[1]!.condition = "absent";
  v.version = "V2";
});

const conflicted: DraftRecord = {
  id: "i1",
  entity: "inspection",
  data: mine,
  status: "conflict",
  step: 0,
  errors: {},
  conflict: {
    current: { ...theirs, updatedAt: "2026-10-27T17:58:00+00:00" },
    base: vistoria,
    collisions: [],
  },
  updatedAt: "2026-10-27T18:02:00.000Z",
};

function open(over: Partial<typeof EMPTY> = {}, id = "i1") {
  navigation.search = `?id=${id}`;
  local.value = {
    ...EMPTY,
    clients: [lar],
    properties: [apto],
    inspections: [vistoria],
    drafts: [conflicted],
    ...over,
  };
  return render(
    <AppShell>
      <ConflictScreen />
    </AppShell>,
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

afterEach(() => {
  vi.mocked(resolveInspectionConflict).mockClear();
  navigation.back.mockReset();
  navigation.replace.mockReset();
  resetSyncStatus();
  resetSession();
});

describe("ConflictScreen", () => {
  it("só o que colidiu, no ambiente, com 'Antes', os dois valores e as horas de cada lado", async () => {
    open();

    expect(await screen.findByRole("heading", { level: 1, name: "Conflito" })).toBeDefined();
    expect(
      screen.getByText(/R\. das Flores, 120 · Apto 302 · Vistoria de entrada\. Ela foi alterada/),
    ).toBeDefined();
    const kitchen = screen.getByRole("region", { name: "Cozinha" });
    const field = within(kitchen).getByRole("radiogroup", { name: "Paredes · Condição" });
    expect(within(kitchen).getAllByRole("radiogroup")).toHaveLength(1);
    expect(within(kitchen).getByText("Antes: Regular")).toBeDefined();
    expect(within(field).getByRole("radio", { name: /Neste aparelho.*Ruim/ })).toBeDefined();
    expect(within(field).getByRole("radio", { name: /No servidor.*Ausente/ })).toBeDefined();
    expect(within(field).getByText(`Neste aparelho · ${time(conflicted.updatedAt)}`)).toBeDefined();
    expect(
      within(field).getByText(`No servidor · ${time("2026-10-27T17:58:00+00:00")}`),
    ).toBeDefined();
    expect(screen.getByText("0 de 1 campo resolvido")).toBeDefined();
    expect(screen.getByText("Falta 1 campo")).toBeDefined();
    expect(screen.getByRole("button", { name: "Enviar resolução" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("'Usar todos os meus' e enviar: a resolução leva o local e a version do current, e a tela volta", async () => {
    const user = userEvent.setup();
    window.history.pushState(null, "", "/inspections/conflict?id=i1");
    open();

    await user.click(await screen.findByRole("button", { name: "Usar todos os meus" }));
    expect(screen.getByText("1 de 1 campo resolvido")).toBeDefined();
    expect(screen.getByText("Tudo escolhido")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Enviar resolução" }));

    expect(resolveInspectionConflict).toHaveBeenCalledOnce();
    const [, { resolved, server }] = vi.mocked(resolveInspectionConflict).mock.calls[0]!;
    expect(resolved).toEqual({ ...mine, version: "V2" });
    expect(server.version).toBe("V2");
    expect(navigation.back).toHaveBeenCalledOnce();
  });

  it("escolher o do servidor no campo: o resto que só mudou aqui segue junto", async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByText("Ausente"));
    await user.click(screen.getByRole("button", { name: "Enviar resolução" }));

    const [, { resolved }] = vi.mocked(resolveInspectionConflict).mock.calls[0]!;
    expect(resolved).toEqual(
      edited((v) => {
        v.rooms[0]!.items[1]!.condition = "absent";
        v.rooms[0]!.items[0]!.notes = "Trincado.";
        v.version = "V2";
      }),
    );
  });

  it("'Voltar' não envia nada", async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Voltar" }));

    expect(resolveInspectionConflict).not.toHaveBeenCalled();
  });

  it("sem conflito para resolver: o aviso e 'Abrir a vistoria'", () => {
    open({ drafts: [] });

    expect(screen.getByText("Esta vistoria não tem conflito para resolver.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Abrir a vistoria" }).getAttribute("href")).toBe(
      "/inspections/edit?id=i1",
    );
  });

  it("vistoria que não está no aparelho: 'Voltar para a lista'", () => {
    open({ drafts: [], inspections: [] }, "i9");

    expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe(
      "/inspections",
    );
  });
});
