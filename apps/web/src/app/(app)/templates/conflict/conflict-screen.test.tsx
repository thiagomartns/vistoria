import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TemplateRecord } from "@/features/templates/models/template";
import { resolveTemplateConflict } from "@/features/templates/services/templates.sync";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "../../app-shell";
import { TemplateConflictScreen } from "./conflict-screen";

// /templates/conflict?id= dentro do shell (Figma "Roteiros (#173)", estado 7; ADR 0038 e 0057), com o banco local
// simulado no hook e o envio da resolução espionado.

const navigation = vi.hoisted(() => ({
  search: "",
  back: vi.fn<() => void>(),
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/templates/conflict",
  useRouter: () => ({ back: navigation.back, push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => [] }));

const EMPTY = {
  store: { templates: {}, drafts: {}, outbox: {} },
  ready: true,
  templates: [] as TemplateRecord[],
  drafts: [] as DraftRecord[],
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/templates/services/templates.sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/templates/services/templates.sync")>()),
  resolveTemplateConflict: vi.fn<() => Promise<void>>(async () => {}),
}));

const items = (names: string[]) =>
  names.map((name, position) => ({ id: `i-${name}`, name, position }));

const apartamento: TemplateRecord = {
  id: "t1",
  version: "A",
  name: "Apartamento",
  rooms: [
    { id: "sala", name: "Sala", position: 0, items: items(["Piso", "Teto"]) },
    { id: "cozinha", name: "Cozinha", position: 1, items: items(["Pia"]) },
  ],
};

// Aqui, o nome e uma Varanda; no outro aparelho, o nome e a Cozinha que saiu.
const mine: TemplateRecord = {
  ...apartamento,
  name: "Apartamento padrão",
  rooms: [...apartamento.rooms, { id: "varanda", name: "Varanda", position: 2, items: [] }],
};
const theirs: TemplateRecord = {
  ...apartamento,
  version: "B",
  name: "Apartamento 2 quartos",
  rooms: [apartamento.rooms[0]!],
};

const conflicted: DraftRecord = {
  id: "t1",
  entity: "template",
  data: mine,
  status: "conflict",
  errors: {},
  conflict: {
    current: { ...theirs, updatedAt: "2026-11-12T17:58:00+00:00" },
    base: apartamento,
    collisions: [],
  },
  updatedAt: "2026-11-12T18:02:00.000Z",
};

function open(over: Partial<typeof EMPTY> = {}, id = "t1") {
  navigation.search = `?id=${id}`;
  local.value = { ...EMPTY, templates: [apartamento], drafts: [conflicted], ...over };
  return render(
    <AppShell>
      <TemplateConflictScreen />
    </AppShell>,
  );
}

afterEach(() => {
  vi.mocked(resolveTemplateConflict).mockClear();
  navigation.back.mockReset();
  resetSyncStatus();
  resetSession();
});

describe("TemplateConflictScreen", () => {
  it("um grupo Roteiro com Nome e Ambientes; os ambientes resumidos de cada lado", async () => {
    open();

    expect(await screen.findByRole("heading", { level: 1, name: "Conflito" })).toBeDefined();
    expect(
      screen.getByText(/^Apartamento padrão\. Ele foi alterado em outro aparelho/),
    ).toBeDefined();
    const group = screen.getByRole("region", { name: "Roteiro" });
    const fields = within(group).getAllByRole("radiogroup");
    expect(fields.map((field) => field.getAttribute("aria-label"))).toEqual(["Nome", "Ambientes"]);
    const rooms = fields[1]!;
    expect(within(group).getByText("Antes: 2 ambientes, 3 itens")).toBeDefined();
    expect(
      within(rooms).getByRole("radio", {
        name: /Neste aparelho.*Sala \(2 itens\), Cozinha \(1 item\), Varanda \(0 itens\)/,
      }),
    ).toBeDefined();
    expect(
      within(rooms).getByRole("radio", { name: /No servidor.*Sala \(2 itens\)$/ }),
    ).toBeDefined();
    expect(screen.getByText("Faltam 2 campos")).toBeDefined();
  });

  it("misto: o nome daqui e os ambientes de lá, a lista inteira", async () => {
    const user = userEvent.setup();
    window.history.pushState(null, "", "/templates/conflict?id=t1");
    open();

    await user.click(await screen.findByText("Apartamento padrão"));
    await user.click(
      within(screen.getAllByRole("radiogroup")[1]!).getByRole("radio", { name: /No servidor/ }),
    );
    await user.click(screen.getByRole("button", { name: "Enviar resolução" }));

    const [, { resolved }] = vi.mocked(resolveTemplateConflict).mock.calls[0]!;
    expect(resolved).toEqual({
      ...apartamento,
      version: "B",
      name: "Apartamento padrão",
      rooms: theirs.rooms,
    });
    expect(navigation.back).toHaveBeenCalledOnce();
  });

  it("sem conflito para resolver: o aviso e 'Abrir o roteiro'", () => {
    open({ drafts: [] });

    expect(screen.getByText("Este roteiro não tem conflito para resolver.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Abrir o roteiro" }).getAttribute("href")).toBe(
      "/templates/edit?id=t1",
    );
  });
});
