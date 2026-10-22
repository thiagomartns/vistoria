import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { PropertyRecord } from "@/features/properties/models/property";
import { saveClient } from "@/features/clients/services/clients.sync";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
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

  it("id que não está no aparelho: aviso e volta para a lista", () => {
    open("nao-existe");

    expect(heading().textContent).toBe("Cliente");
    expect(screen.getByText("Este cliente não está neste aparelho.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe(
      "/clients",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
