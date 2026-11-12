import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TemplateRecord } from "@/features/templates/models/template";
import { fetchTemplate, saveTemplate } from "@/features/templates/services/templates.sync";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { FetchOutcome } from "@/shared/sync/fetch";
import { resetSyncStatus } from "@/shared/sync/sync-status";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { AppShell } from "../../app-shell";
import { TemplateEditScreen } from "./template-edit-screen";

// O editor dentro do shell (o header é dele), com o banco local simulado no hook e o saveTemplate espionado. O jsdom
// não tem matchMedia: a tela abre como no celular, em dois níveis; o desktop entra pelo stub.

const navigation = vi.hoisted(() => ({
  search: "",
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/templates/edit",
  useRouter: () => ({ push: navigation.push, replace: vi.fn<() => void>() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => {} }));

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

vi.mock("@/features/templates/services/templates.sync", () => ({
  saveTemplate: vi.fn<() => string>(() => "novo-id"),
  fetchTemplate: vi.fn<(store: unknown, id: string) => Promise<FetchOutcome>>(
    async () => "not-found",
  ),
  templateConflictHref: (id: string) => `/templates/conflict?id=${id}`,
}));

const items = (room: string, names: string[]) =>
  names.map((name, position) => ({ id: `${room}-${name}`, name, position }));

const apartamento: TemplateRecord = {
  id: "t1",
  version: "AAAAAAAAB9M=",
  name: "Apartamento",
  rooms: [
    { id: "sala", name: "Sala", position: 0, items: items("sala", ["Piso", "Paredes", "Teto"]) },
    { id: "cozinha", name: "Cozinha", position: 1, items: items("cozinha", ["Piso", "Pia"]) },
    { id: "varanda", name: "Varanda", position: 2, items: [] },
  ],
};

function open(id: string | null, over: Partial<typeof local.value> = {}) {
  navigation.search = id ? `?id=${id}` : "";
  local.value = { ...local.value, ...over };
  return render(
    <AppShell>
      <TemplateEditScreen />
    </AppShell>,
  );
}

const desktop = () =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 768px)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

const heading = () => screen.getByRole("heading", { level: 1 });
const header = () => heading().closest("header")!;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const roomsList = () => screen.getByRole("list", { name: "Ambientes" });
const itemsList = () => screen.getByRole("list", { name: "Itens" });
/** O botão que abre o ambiente na lista ("Sala 3 itens"). */
const roomButton = (name: string) =>
  within(roomsList()).getByRole("button", { name: new RegExp(`^${name}`) });
const roomDetails = () =>
  within(roomsList())
    .getAllByRole("listitem")
    .map(
      (row) => row.querySelector("button[type=button]:not([aria-roledescription])")?.textContent,
    );
const itemValues = () =>
  within(itemsList())
    .getAllByRole("textbox")
    .map((input) => (input as HTMLInputElement).value);
const saved = () => vi.mocked(saveTemplate).mock.calls[0]?.[1];

afterEach(() => {
  local.value = { store: {}, ready: true, templates: [], drafts: [], states: new Map() };
  navigation.push.mockReset();
  vi.mocked(saveTemplate).mockClear();
  vi.mocked(fetchTemplate).mockReset().mockResolvedValue("not-found");
  vi.unstubAllGlobals();
  resetSyncStatus();
  resetSession();
});

describe("TemplateEditScreen · novo", () => {
  it("título 'Novo roteiro', nome vazio e um ambiente vazio para começar; Voltar e Cancelar para a lista", () => {
    open(null);

    expect(heading().textContent).toBe("Novo roteiro");
    expect(within(header()).getByRole("link", { name: "Voltar" }).getAttribute("href")).toBe(
      "/templates",
    );
    expect(field("Nome do roteiro").value).toBe("");
    expect(roomDetails()).toEqual(["Ambiente sem nome0 itens"]);
    expect(screen.getByText("1 de 40")).toBeDefined();
    expect(screen.getByRole("link", { name: "Cancelar" }).getAttribute("href")).toBe("/templates");
  });

  it("valida no aparelho: o nome do roteiro e, depois, o ambiente sem nome, que abre sozinho", async () => {
    const user = userEvent.setup();
    open(null);

    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));
    expect(await screen.findByText("Informe o nome.")).toBeDefined();

    await user.type(field("Nome do roteiro"), "Casa térrea");
    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

    expect(await screen.findByText("Informe o nome do ambiente.")).toBeDefined();
    expect(heading().textContent).toBe("Ambiente sem nome");
    expect(saveTemplate).not.toHaveBeenCalled();
  });

  it("celular, dois níveis: o ambiente abre os itens; o Voltar do cabeçalho volta sem perder nada; salvar grava e volta", async () => {
    const user = userEvent.setup();
    open(null);

    await user.type(field("Nome do roteiro"), " Casa térrea ");
    await user.click(roomButton("Ambiente sem nome"));
    expect(screen.queryByLabelText("Nome do roteiro")).toBeNull();
    await user.type(field("Nome do ambiente"), "Sala");
    expect(heading().textContent).toBe("Sala");
    await user.click(screen.getByRole("button", { name: "Adicionar item" }));
    expect(document.activeElement).toBe(field("Item 1"));
    await user.type(field("Item 1"), "Piso");
    await user.click(screen.getByRole("button", { name: "Adicionar item" }));
    await user.type(field("Item 2"), "Teto");

    await user.click(within(header()).getByRole("button", { name: "Voltar" }));
    expect(heading().textContent).toBe("Novo roteiro");
    expect(field("Nome do roteiro").value).toBe(" Casa térrea ");
    expect(roomDetails()).toEqual(["Sala2 itens"]);

    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/templates"));
    expect(saveTemplate).toHaveBeenCalledWith(local.value.store, {
      id: undefined,
      name: "Casa térrea",
      rooms: [
        {
          id: expect.any(String),
          name: "Sala",
          position: 0,
          items: [
            { id: expect.any(String), name: "Piso", position: 0 },
            { id: expect.any(String), name: "Teto", position: 1 },
          ],
        },
      ],
    });
  });

  it("Adicionar ambiente cria um vazio e abre o nome dele", async () => {
    const user = userEvent.setup();
    open(null);

    await user.click(screen.getByRole("button", { name: "Adicionar ambiente" }));

    expect(heading().textContent).toBe("Ambiente sem nome");
    expect(document.activeElement).toBe(field("Nome do ambiente"));
    await user.click(within(header()).getByRole("button", { name: "Voltar" }));
    expect(screen.getByText("2 de 40")).toBeDefined();
  });
});

describe("TemplateEditScreen · edição", () => {
  it("o registro no formulário, o nome no título e o sincronizado no cabeçalho", () => {
    open("t1", { templates: [apartamento] });

    expect(heading().textContent).toBe("Apartamento");
    expect(field("Nome do roteiro").value).toBe("Apartamento");
    expect(roomDetails()).toEqual(["Sala3 itens", "Cozinha2 itens", "Varanda0 itens"]);
    expect(screen.getByText("3 de 40")).toBeDefined();
    expect(header().querySelector('span[data-state="sincronizado"]')?.textContent).toBe(
      "Sincronizado",
    );
  });

  it("edição pendente: 'Salvo no aparelho' no cabeçalho", () => {
    open("t1", { templates: [apartamento], states: new Map([["t1", "local"]]) });

    expect(within(header()).getByText("Salvo no aparelho")).toBeDefined();
  });

  it("sem mudança não enfileira (ADR 0028), só volta", async () => {
    const user = userEvent.setup();
    open("t1", { templates: [apartamento] });

    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/templates"));
    expect(saveTemplate).not.toHaveBeenCalled();
  });

  it("renomear e remover item; o ambiente sem itens sai direto, sem Dialog", async () => {
    const user = userEvent.setup();
    open("t1", { templates: [apartamento] });

    await user.click(roomButton("Sala"));
    await user.clear(field("Item 2"));
    await user.type(field("Item 2"), "Paredes e rodapé");
    await user.click(screen.getByRole("button", { name: "Remover Teto" }));
    expect(itemValues()).toEqual(["Piso", "Paredes e rodapé"]);
    await user.click(within(header()).getByRole("button", { name: "Voltar" }));

    await user.click(roomButton("Varanda"));
    await user.click(screen.getByRole("button", { name: "Remover ambiente" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(heading().textContent).toBe("Apartamento");
    expect(roomDetails()).toEqual(["Sala2 itens", "Cozinha2 itens"]);

    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

    await vi.waitFor(() => expect(saveTemplate).toHaveBeenCalledOnce());
    expect(saved()).toEqual({
      id: "t1",
      name: "Apartamento",
      rooms: [
        {
          id: "sala",
          name: "Sala",
          position: 0,
          items: [
            { id: "sala-Piso", name: "Piso", position: 0 },
            { id: "sala-Paredes", name: "Paredes e rodapé", position: 1 },
          ],
        },
        { id: "cozinha", name: "Cozinha", position: 1, items: items("cozinha", ["Piso", "Pia"]) },
      ],
    });
  });

  it("remover ambiente com itens pede confirmação; Cancelar mantém, Remover tira", async () => {
    const user = userEvent.setup();
    open("t1", { templates: [apartamento] });

    await user.click(roomButton("Sala"));
    await user.click(screen.getByRole("button", { name: "Remover ambiente" }));
    const dialog = screen.getByRole("dialog", { name: "Remover ambiente?" });
    expect(
      within(dialog).getByText("Sala tem 3 itens. Eles saem do roteiro junto com o ambiente."),
    ).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(heading().textContent).toBe("Sala");

    await user.click(screen.getByRole("button", { name: "Remover ambiente" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remover ambiente" }),
    );

    expect(heading().textContent).toBe("Apartamento");
    expect(roomDetails()).toEqual(["Cozinha2 itens", "Varanda0 itens"]);
  });

  it("o pull muda o registro com a tela aberta: salvar ainda enfileira o que a pessoa editou (#144)", async () => {
    const user = userEvent.setup();
    const { rerender } = open("t1", { templates: [apartamento] });
    await user.clear(field("Nome do roteiro"));
    await user.type(field("Nome do roteiro"), "Apartamento padrão");

    local.value = {
      ...local.value,
      templates: [
        {
          ...apartamento,
          version: "AAAAAAAAB9Q=",
          rooms: apartamento.rooms.map((room) =>
            room.id === "varanda" ? { ...room, name: "Sacada" } : room,
          ),
        },
      ],
    };
    rerender(
      <AppShell>
        <TemplateEditScreen />
      </AppShell>,
    );
    await vi.waitFor(() => expect(roomDetails()).toContain("Sacada0 itens"));
    expect(field("Nome do roteiro").value).toBe("Apartamento padrão");
    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

    await vi.waitFor(() => expect(saveTemplate).toHaveBeenCalledOnce());
    expect(saved()?.name).toBe("Apartamento padrão");
    expect(saved()?.rooms[2]?.name).toBe("Sacada");
  });

  it("no limite de itens, Adicionar item desabilita", async () => {
    const user = userEvent.setup();
    const full = Array.from({ length: 60 }, (_, index) => `Item ${index}`);
    open("t1", {
      templates: [
        {
          ...apartamento,
          rooms: [{ id: "sala", name: "Sala", position: 0, items: items("sala", full) }],
        },
      ],
    });

    await user.click(roomButton("Sala"));

    expect(screen.getByText("60 de 60")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Adicionar item" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("TemplateEditScreen · desktop", () => {
  beforeEach(desktop);

  it("dois painéis: os ambientes à esquerda, com o primeiro aberto, e os itens dele à direita", async () => {
    const user = userEvent.setup();
    open("t1", { templates: [apartamento] });

    expect(field("Nome do roteiro").value).toBe("Apartamento");
    expect(roomButton("Sala").getAttribute("aria-current")).toBe("true");
    expect(field("Nome do ambiente").value).toBe("Sala");
    expect(itemValues()).toEqual(["Piso", "Paredes", "Teto"]);
    expect(screen.getByText("3 de 60")).toBeDefined();

    await user.click(roomButton("Cozinha"));

    expect(roomButton("Cozinha").getAttribute("aria-current")).toBe("true");
    expect(field("Nome do ambiente").value).toBe("Cozinha");
    expect(itemValues()).toEqual(["Piso", "Pia"]);
    expect(heading().textContent).toBe("Apartamento");
  });

  describe("reordenar pelo teclado (dnd-kit): Espaço pega, seta move, Espaço solta", () => {
    // O jsdom não mede layout: cada linha de lista reordenável mede 56 px, uma embaixo da outra, pela posição dela.
    beforeEach(() => {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element,
      ) {
        const row = this.closest("li");
        const index = row?.parentElement ? [...row.parentElement.children].indexOf(row) : 0;
        const top = row ? index * 64 : 0;
        const height = row ? 56 : 0;
        return {
          x: 0,
          y: top,
          top,
          left: 0,
          width: 300,
          height,
          right: 300,
          bottom: top + height,
          toJSON: () => ({}),
        };
      });
    });
    afterEach(() => vi.restoreAllMocks());

    async function moveDown(user: ReturnType<typeof userEvent.setup>, handle: HTMLElement) {
      act(() => handle.focus());
      await user.keyboard(" ");
      await user.keyboard("{ArrowDown}");
      await user.keyboard(" ");
    }

    it("ambientes e itens: a ordem nova vai para o registro salvo, e o ambiente aberto segue o mesmo", async () => {
      const user = userEvent.setup();
      open("t1", { templates: [apartamento] });

      await moveDown(user, screen.getByRole("button", { name: "Mover Sala" }));
      await vi.waitFor(() =>
        expect(roomDetails()).toEqual(["Cozinha2 itens", "Sala3 itens", "Varanda0 itens"]),
      );
      expect(roomButton("Sala").getAttribute("aria-current")).toBe("true");

      await moveDown(user, screen.getByRole("button", { name: "Mover Piso" }));
      await vi.waitFor(() => expect(itemValues()).toEqual(["Paredes", "Piso", "Teto"]));

      await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

      await vi.waitFor(() => expect(saveTemplate).toHaveBeenCalledOnce());
      expect(saved()?.rooms.map((room) => [room.id, room.position])).toEqual([
        ["cozinha", 0],
        ["sala", 1],
        ["varanda", 2],
      ]);
      expect(saved()?.rooms[1]?.items.map((item) => [item.name, item.position])).toEqual([
        ["Paredes", 0],
        ["Piso", 1],
        ["Teto", 2],
      ]);
    });
  });
});

describe("TemplateEditScreen · recusa do servidor (400 validation)", () => {
  const long = "Tomadas e interruptores da parede da pia, ao lado da janela grande";
  const rejected = (errors: Record<string, string[]>): DraftRecord => ({
    id: "t1",
    entity: "template",
    data: {
      ...apartamento,
      rooms: apartamento.rooms.map((room) =>
        room.id === "cozinha"
          ? { ...room, items: [{ ...room.items[0]!, name: long }, room.items[1]!] }
          : room,
      ),
    },
    status: "rejected",
    errors,
    updatedAt: "2026-11-12T12:00:00.000Z",
  });

  it("o Alert no topo, o ambiente com '· 1 correção' e o erro no campo do item, com 'Correção necessária'", async () => {
    const user = userEvent.setup();
    open("t1", {
      templates: [apartamento],
      drafts: [
        rejected({ "rooms[1].items[0].name": ["O nome do item pode ter até 60 caracteres."] }),
      ],
    });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("O servidor recusou este roteiro")).toBeDefined();
    expect(within(alert).getByText("Corrija o que está marcado e salve de novo.")).toBeDefined();
    expect(within(header()).getByText("Correção necessária")).toBeDefined();
    expect(roomDetails()).toEqual(["Sala3 itens", "Cozinha2 itens · 1 correção", "Varanda0 itens"]);

    await user.click(roomButton("Cozinha"));

    expect(field("Item 1").value).toBe(long);
    expect(field("Item 1").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("O nome do item pode ter até 60 caracteres.")).toBeDefined();
    expect(field("Item 2").getAttribute("aria-invalid")).toBe("false");
  });

  it("corrigir e salvar enfileira de novo", async () => {
    const user = userEvent.setup();
    open("t1", {
      templates: [apartamento],
      drafts: [
        rejected({ "rooms[1].items[0].name": ["O nome do item pode ter até 60 caracteres."] }),
      ],
    });

    await user.click(roomButton("Cozinha"));
    await user.clear(field("Item 1"));
    await user.type(field("Item 1"), "Tomadas");
    await user.click(within(header()).getByRole("button", { name: "Voltar" }));
    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

    await vi.waitFor(() => expect(saveTemplate).toHaveBeenCalledOnce());
    expect(saved()?.rooms[1]?.items[0]).toEqual({
      id: "cozinha-Piso",
      name: "Tomadas",
      position: 0,
    });
  });

  it("erro numa chave que o formulário não tem: a mensagem vai no Alert", () => {
    open("t1", {
      templates: [apartamento],
      drafts: [rejected({ rooms: ["O roteiro pode ter até 40 ambientes."] })],
    });

    expect(
      within(screen.getByRole("alert")).getByText(/^O roteiro pode ter até 40 ambientes\. Corrija/),
    ).toBeDefined();
  });
});

describe("TemplateEditScreen · conflito (412 com colisão)", () => {
  const conflicted: DraftRecord = {
    id: "t1",
    entity: "template",
    data: { ...apartamento, name: "Apartamento padrão" },
    status: "conflict",
    errors: {},
    conflict: {
      current: { ...apartamento, version: "AAAAAAAAB9U=", name: "Apartamento 2 quartos" },
      base: apartamento,
      collisions: [],
    },
    updatedAt: "2026-11-12T18:02:00.000Z",
  };

  it("o aviso e 'Resolver conflito' acima do formulário, com o que foi salvo aqui", () => {
    open("t1", { templates: [apartamento], drafts: [conflicted] });

    expect(screen.getByText("Este roteiro foi alterado em outro aparelho")).toBeDefined();
    expect(screen.getByRole("link", { name: "Resolver conflito" }).getAttribute("href")).toBe(
      "/templates/conflict?id=t1",
    );
    expect(field("Nome do roteiro").value).toBe("Apartamento padrão");
  });

  it("salvar leva ao ConflictResolver, não à lista", async () => {
    const user = userEvent.setup();
    open("t1", { templates: [apartamento], drafts: [conflicted] });

    await user.type(field("Nome do roteiro"), "!");
    await user.click(screen.getByRole("button", { name: "Salvar roteiro" }));

    await vi.waitFor(() => expect(saveTemplate).toHaveBeenCalledOnce());
    expect(saved()?.name).toBe("Apartamento padrão!");
    expect(navigation.push).toHaveBeenCalledWith("/templates/conflict?id=t1");
  });
});

describe("TemplateEditScreen · id que não está no aparelho (leitura por id)", () => {
  it("busca no servidor e, enquanto busca, não mostra aviso nem formulário", () => {
    vi.mocked(fetchTemplate).mockReturnValue(new Promise(() => {}));
    open("nao-existe");

    expect(vi.mocked(fetchTemplate)).toHaveBeenCalledWith(local.value.store, "nao-existe");
    expect(heading().textContent).toBe("Roteiro");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("404: não existe, com a volta para a lista", async () => {
    open("nao-existe");

    expect(await screen.findByText("Este roteiro não existe.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe(
      "/templates",
    );
  });

  it("sem rede: explica que é preciso abrir uma vez com internet", async () => {
    vi.mocked(fetchTemplate).mockResolvedValue("offline");
    open("nao-existe");

    expect(
      await screen.findByText(
        "Este roteiro ainda não está neste aparelho. Abra-o uma vez com internet para trabalhar nele offline.",
      ),
    ).toBeDefined();
  });

  it("falha do servidor: Tentar de novo busca outra vez", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchTemplate).mockResolvedValue("failed");
    open("nao-existe");

    await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));

    await vi.waitFor(() => expect(vi.mocked(fetchTemplate)).toHaveBeenCalledTimes(2));
  });
});
