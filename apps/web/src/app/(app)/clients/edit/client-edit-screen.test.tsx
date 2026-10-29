import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";
import { fetchClient, saveClient } from "@/features/clients/services/clients.sync";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { FetchOutcome } from "@/shared/sync/fetch";
import { resetSyncStatus } from "@/shared/sync/sync-status";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { AppShell } from "../../app-shell";
import { ClientEditScreen } from "./client-edit-screen";

// A tela dentro do shell (o header é dele), com o banco local de clients simulado no hook e o saveClient espionado.

const navigation = vi.hoisted(() => ({
  search: "",
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/clients/edit",
  useRouter: () => ({ push: navigation.push, replace: vi.fn<() => void>() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => {} }));

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

vi.mock("@/features/clients/services/clients.sync", () => ({
  saveClient: vi.fn<() => string>(() => "novo-id"),
  fetchClient: vi.fn<(store: unknown, id: string) => Promise<FetchOutcome>>(async () => "not-found"),
  clientConflictHref: (id: string) => `/clients/conflict?id=${id}`,
}));

const maria: ClientRecord = {
  id: "c2",
  version: "AAAAAAAAB9M=",
  name: "Maria Souza",
  document: "52998224725",
  email: "maria.souza@email.com",
  phone: "(11) 98765-4321",
};

function open(id: string | null, over: Partial<typeof local.value> = {}) {
  navigation.search = id ? `?id=${id}` : "";
  local.value = { ...local.value, ...over };
  return render(
    <AppShell>
      <ClientEditScreen />
    </AppShell>,
  );
}

const heading = () => screen.getByRole("heading", { level: 1 });
const header = () => heading().closest("header")!;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

afterEach(() => {
  local.value = {
    store: {},
    ready: true,
    clients: [],
    properties: [],
    drafts: [],
    states: new Map(),
  };
  navigation.push.mockReset();
  vi.mocked(saveClient).mockClear();
  vi.mocked(fetchClient).mockReset().mockResolvedValue("not-found");
  resetSyncStatus();
  resetSession();
});

describe("ClientEditScreen", () => {
  it("novo: título 'Novo cliente', Voltar para a lista, campos vazios e sem SyncBadge", () => {
    open(null);

    expect(heading().textContent).toBe("Novo cliente");
    expect(within(header()).getByRole("link", { name: "Voltar" }).getAttribute("href")).toBe(
      "/clients",
    );
    expect(field("Nome").value).toBe("");
    expect(screen.getByText("Opcional. Validado ao salvar.")).toBeDefined();
    expect(within(header()).queryByText("Salvo no aparelho")).toBeNull();
    expect(screen.getByRole("link", { name: "Cancelar" }).getAttribute("href")).toBe("/clients");
  });

  it("novo: valida no aparelho antes de salvar (nome, CPF/CNPJ, e-mail)", async () => {
    const user = userEvent.setup();
    open(null);

    await user.type(field("CPF ou CNPJ"), "529.982.247-24");
    await user.type(field("E-mail"), "maria");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe o nome.")).toBeDefined();
    expect(screen.getByText("Informe um CPF ou CNPJ válido.")).toBeDefined();
    expect(screen.getByText("Informe um e-mail válido.")).toBeDefined();
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("novo: salvar grava no banco local (sem máscara, vazio vira null) e volta para a lista", async () => {
    const user = userEvent.setup();
    open(null);

    await user.type(field("Nome"), "Maria Souza");
    await user.type(field("CPF ou CNPJ"), "529.982.247-25");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/clients"));
    expect(saveClient).toHaveBeenCalledWith(local.value.store, {
      id: undefined,
      name: "Maria Souza",
      document: "52998224725",
      email: null,
      phone: null,
    });
  });

  it("edição: o registro no formulário e no título; sincronizado aparece no cabeçalho", () => {
    open("c2", { clients: [maria] });

    expect(heading().textContent).toBe("Maria Souza");
    expect(field("Nome").value).toBe("Maria Souza");
    expect(field("CPF ou CNPJ").value).toBe("529.982.247-25");
    expect(field("E-mail").value).toBe("maria.souza@email.com");
    expect(header().querySelector('span[data-state="sincronizado"]')?.textContent).toBe(
      "Sincronizado",
    );
  });

  it("edição pendente: 'Salvo no aparelho' no cabeçalho", () => {
    open("c2", { clients: [maria], states: new Map([["c2", "local"]]) });

    expect(within(header()).getByText("Salvo no aparelho")).toBeDefined();
  });

  it("edição sem mudança não enfileira (ADR 0028), só volta", async () => {
    const user = userEvent.setup();
    open("c2", { clients: [maria] });

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/clients"));
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("edição com mudança enfileira o registro com o id", async () => {
    const user = userEvent.setup();
    open("c2", { clients: [maria] });

    await user.clear(field("Telefone"));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await vi.waitFor(() => expect(saveClient).toHaveBeenCalledOnce());
    expect(vi.mocked(saveClient).mock.calls[0]?.[1]).toEqual({
      id: "c2",
      name: "Maria Souza",
      document: "52998224725",
      email: "maria.souza@email.com",
      phone: null,
    });
  });

  describe("recusa do servidor (400 validation)", () => {
    const rejected = (errors: Record<string, string[]>): DraftRecord => ({
      id: "c2",
      entity: "client",
      data: { ...maria, document: "52998224724" },
      status: "rejected",
      errors,
      updatedAt: "2026-10-22T12:00:00.000Z",
    });

    it("o erro volta no campo certo, com o valor recusado e 'Correção necessária'", async () => {
      open("c2", {
        clients: [maria],
        drafts: [rejected({ document: ["Informe um CPF ou CNPJ válido, sem pontuação."] })],
      });

      const message = await screen.findByText("Informe um CPF ou CNPJ válido, sem pontuação.");
      const document = field("CPF ou CNPJ");
      expect(message.closest("[data-slot=form-item]")?.contains(document)).toBe(true);
      expect(document.value).toBe("529.982.247-24");
      expect(document.getAttribute("aria-invalid")).toBe("true");
      expect(field("Nome").getAttribute("aria-invalid")).toBe("false");
      expect(within(header()).getByText("Correção necessária")).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("corrigir e salvar enfileira de novo", async () => {
      const user = userEvent.setup();
      open("c2", { clients: [maria], drafts: [rejected({ name: ["Nome recusado."] })] });
      expect(await screen.findByText("Nome recusado.")).toBeDefined();

      await user.clear(field("Nome"));
      await user.type(field("Nome"), "Maria S. Souza");
      // O rascunho também traz o CPF recusado; a validação do aparelho barra até corrigir.
      await user.clear(field("CPF ou CNPJ"));
      await user.type(field("CPF ou CNPJ"), "52998224725");
      await user.click(screen.getByRole("button", { name: "Salvar" }));

      await vi.waitFor(() => expect(saveClient).toHaveBeenCalledOnce());
      expect(vi.mocked(saveClient).mock.calls[0]?.[1]).toMatchObject({ id: "c2", name: "Maria S. Souza" });
    });

    it("erro numa chave que o formulário não tem: Alert no topo do formulário", () => {
      open("c2", { clients: [maria], drafts: [rejected({ "": ["Corpo ilegível."] })] });

      expect(screen.getByRole("alert").textContent).toBe(
        "O servidor recusou este cadastro. Corrija e salve de novo.",
      );
    });
  });

  describe("conflito (412 com colisão)", () => {
    const conflicted: DraftRecord = {
      id: "c2",
      entity: "client",
      data: { ...maria, phone: "(11) 91111-2222" },
      status: "conflict",
      errors: {},
      conflict: {
        current: { ...maria, version: "AAAAAAAAB9U=", phone: "(11) 93333-4444" },
        base: maria,
        collisions: [],
      },
      updatedAt: "2026-10-27T18:02:00.000Z",
    };

    it("o aviso e 'Resolver conflito' acima do formulário, com o que foi salvo aqui", () => {
      open("c2", { clients: [maria], drafts: [conflicted] });

      expect(screen.getByText("Este cliente foi alterado em outro aparelho")).toBeDefined();
      expect(screen.getByRole("link", { name: "Resolver conflito" }).getAttribute("href")).toBe(
        "/clients/conflict?id=c2",
      );
      expect(within(header()).getByText("Conflito")).toBeDefined();
      expect(field("Telefone").value).toBe("(11) 91111-2222");
    });

    it("salvar leva ao ConflictResolver, não à lista", async () => {
      const user = userEvent.setup();
      open("c2", { clients: [maria], drafts: [conflicted] });

      await user.clear(field("Telefone"));
      await user.type(field("Telefone"), "(11) 95555-6666");
      await user.click(screen.getByRole("button", { name: "Salvar" }));

      await vi.waitFor(() => expect(saveClient).toHaveBeenCalledOnce());
      expect(vi.mocked(saveClient).mock.calls[0]?.[1]).toMatchObject({ id: "c2", phone: "(11) 95555-6666" });
      expect(navigation.push).toHaveBeenCalledWith("/clients/conflict?id=c2");
    });

    it("conflito sem current (nada a escolher): sem o aviso, e salvar volta para a lista", async () => {
      const user = userEvent.setup();
      open("c2", {
        clients: [maria],
        drafts: [{ ...conflicted, conflict: { current: undefined, collisions: [] } }],
      });

      expect(screen.queryByRole("link", { name: "Resolver conflito" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Salvar" }));

      await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/clients"));
    });
  });

  describe("id que não está no aparelho (leitura por id)", () => {
    it("busca no servidor e, enquanto busca, não mostra aviso nem formulário", () => {
      vi.mocked(fetchClient).mockReturnValue(new Promise(() => {}));
      open("nao-existe");

      expect(vi.mocked(fetchClient)).toHaveBeenCalledWith(local.value.store, "nao-existe");
      expect(heading().textContent).toBe("Cliente");
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("o que já está no aparelho não é buscado", () => {
      open(null);

      expect(vi.mocked(fetchClient)).not.toHaveBeenCalled();
    });

    it("404: não encontrado, com a volta para a lista", async () => {
      open("nao-existe");

      expect(await screen.findByText("Este cliente não existe ou foi excluído.")).toBeDefined();
      expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe("/clients");
      expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("sem rede: explica que é preciso abrir uma vez com internet", async () => {
      vi.mocked(fetchClient).mockResolvedValue("offline");
      open("nao-existe");

      expect(
        await screen.findByText(
          "Este cliente ainda não está neste aparelho. Abra-o uma vez com internet para trabalhar nele offline.",
        ),
      ).toBeDefined();
      expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    });

    it("falha do servidor: Tentar de novo busca outra vez", async () => {
      const user = userEvent.setup();
      vi.mocked(fetchClient).mockResolvedValue("failed");
      open("nao-existe");

      await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));

      expect(screen.getByText("Não foi possível buscar este cliente agora.")).toBeDefined();
      await vi.waitFor(() => expect(vi.mocked(fetchClient)).toHaveBeenCalledTimes(2));
    });
  });
});
