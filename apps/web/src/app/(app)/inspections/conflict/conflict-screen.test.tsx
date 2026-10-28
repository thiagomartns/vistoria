import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import {
  deleteInspection,
  discardDeletedInspection,
  keepInspection,
  recreateInspection,
  resolveInspectionConflict,
} from "@/features/inspections/services/inspections.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "../../app-shell";
import { ConflictScreen } from "./conflict-screen";

// /inspections/conflict?id= dentro do shell (wireframe 69:2632, ConflictResolver 32:1787), com o banco local simulado
// no hook e o envio da resolução espionado: os tipos edição, excluído e exclusão alterada (#107, estados 7 e 8).

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
  states: new Map<string, string>(),
  bases: new Map<string, Record<string, unknown>>(),
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/inspections/services/inspections.sync", () => ({
  resolveInspectionConflict: vi.fn<() => Promise<void>>(async () => {}),
  recreateInspection: vi.fn<() => Promise<string>>(async () => "i2"),
  discardDeletedInspection: vi.fn<() => Promise<void>>(async () => {}),
  keepInspection: vi.fn<() => void>(),
  deleteInspection: vi.fn<() => Promise<void>>(async () => {}),
  saveInspection: vi.fn<() => string>(() => "i1"),
  saveInspectionDraft: vi.fn<() => void>(),
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
  vi.mocked(recreateInspection).mockClear();
  vi.mocked(discardDeletedInspection).mockClear();
  vi.mocked(keepInspection).mockClear();
  vi.mocked(deleteInspection).mockClear();
  navigation.back.mockReset();
  navigation.push.mockReset();
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

  describe("excluída em outro aparelho (estado 7)", () => {
    const deleted: DraftRecord = {
      ...conflicted,
      conflict: {
        type: "deleted",
        current: undefined,
        base: vistoria,
        collisions: [],
        deletedAt: new Date(2026, 9, 27, 14, 58).toISOString(),
      },
    };

    it("o tipo excluído: título, o que mudou aqui e as duas saídas", async () => {
      open({ drafts: [deleted] });

      expect(
        await screen.findByRole("heading", { name: "Vistoria excluída em outro aparelho" }),
      ).toBeDefined();
      expect(
        screen.getByText(
          "R. das Flores, 120 · Apto 302 · Vistoria de entrada. Ela foi excluída em outro aparelho, mas as suas alterações continuam salvas neste. Recrie a vistoria com os mesmos dados ou descarte as alterações.",
        ),
      ).toBeDefined();
      expect(screen.getByText(/^Excluída (em 27\/10 )?às 14:58 em outro aparelho$/)).toBeDefined();
      expect(
        screen.getByText(
          "Neste aparelho: 2 itens alterados em 1 ambiente. Recriar gera uma vistoria nova, com outro código.",
        ),
      ).toBeDefined();
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });

    it("'Recriar vistoria' vai para a tela de campo da vistoria nova", async () => {
      const user = userEvent.setup();
      open({ drafts: [deleted] });

      await user.click(await screen.findByRole("button", { name: "Recriar vistoria" }));

      expect(recreateInspection).toHaveBeenCalledWith(EMPTY.store, "i1");
      expect(navigation.replace).toHaveBeenCalledWith("/inspections/edit?id=i2");
    });

    it("'Descartar alterações' volta para a lista", async () => {
      const user = userEvent.setup();
      open({ drafts: [deleted] });

      await user.click(await screen.findByRole("button", { name: "Descartar alterações" }));

      expect(discardDeletedInspection).toHaveBeenCalledWith(EMPTY.store, "i1");
      expect(recreateInspection).not.toHaveBeenCalled();
      expect(navigation.replace).toHaveBeenCalledWith("/inspections");
    });
  });

  describe("exclusão alterada (estado 8)", () => {
    const removal: DraftRecord = {
      id: "i1",
      entity: "inspection",
      data: theirs,
      status: "conflict",
      errors: {},
      conflict: { type: "removal", current: theirs, collisions: [] },
      updatedAt: "2026-10-27T18:02:00.000Z",
    };

    it("o 'Excluir mesmo assim?' sobre a tela de campo só leitura, com o que o servidor tem", async () => {
      open({ drafts: [removal], inspections: [theirs] });

      const dialog = await screen.findByRole("dialog", { name: "Excluir mesmo assim?" });
      expect(
        within(dialog).getByText(
          "Esta vistoria foi alterada em outro aparelho depois que você a abriu. Ao excluir, as alterações feitas lá também se perdem.",
        ),
      ).toBeDefined();
      // Atrás do Dialog, a tela de campo fica fora da árvore acessível (aria-hidden), mas está lá.
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "R. das Flores, 120 · Apto 302",
          hidden: true,
        }),
      ).toBeDefined();
      const paredes = screen.getByRole("radiogroup", { name: /Paredes/, hidden: true });
      expect(
        within(paredes)
          .getByRole("radio", { name: "Ausente", hidden: true })
          .getAttribute("aria-checked"),
      ).toBe("true");
      expect(
        within(paredes)
          .getByRole("radio", { name: "Ausente", hidden: true })
          .hasAttribute("disabled"),
      ).toBe(true);
    });

    it("'Excluir vistoria' põe a exclusão de novo na fila e volta para a lista", async () => {
      const user = userEvent.setup();
      open({ drafts: [removal], inspections: [theirs] });

      await user.click(await screen.findByRole("button", { name: "Excluir vistoria" }));

      expect(deleteInspection).toHaveBeenCalledWith(EMPTY.store, "i1");
      expect(navigation.push).toHaveBeenCalledWith("/inspections");
    });

    it("'Cancelar' fica com o servidor e abre a tela de campo; o × só sai, sem decidir", async () => {
      const user = userEvent.setup();
      open({ drafts: [removal], inspections: [theirs] });

      await user.click(await screen.findByRole("button", { name: "Cancelar" }));
      expect(keepInspection).toHaveBeenCalledWith(EMPTY.store, "i1");
      expect(navigation.replace).toHaveBeenCalledWith("/inspections/edit?id=i1");

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(keepInspection).toHaveBeenCalledOnce();
      expect(deleteInspection).not.toHaveBeenCalled();
    });
  });
});
