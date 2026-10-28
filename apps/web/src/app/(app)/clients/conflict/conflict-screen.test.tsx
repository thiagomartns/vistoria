import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import { resolveClientConflict } from "@/features/clients/services/clients.sync";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import { resetSyncStatus } from "@/shared/sync/sync-status";

import { AppShell } from "../../app-shell";
import { ClientConflictScreen } from "./conflict-screen";

// /clients/conflict?id= dentro do shell (ConflictResolver 32:1787, ADR 0038), com o banco local simulado no hook e o
// envio da resolução espionado.

const navigation = vi.hoisted(() => ({
  search: "",
  back: vi.fn<() => void>(),
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/clients/conflict",
  useRouter: () => ({ back: navigation.back, push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => [] }));

const EMPTY = {
  store: { clients: {}, drafts: {}, outbox: {} },
  ready: true,
  clients: [] as ClientRecord[],
  drafts: [] as DraftRecord[],
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/clients/services/clients.sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/clients/services/clients.sync")>()),
  resolveClientConflict: vi.fn<() => Promise<void>>(async () => {}),
}));

const maria: ClientRecord = {
  id: "c2",
  version: "A",
  name: "Maria Souza",
  document: "52998224725",
  email: "maria@email.com",
  phone: null,
};

// Aqui, o CPF e o telefone; no outro aparelho, o CPF e o e-mail.
const mine: ClientRecord = { ...maria, document: "11144477735", phone: "(11) 98765-4321" };
const theirs = { ...maria, version: "B", document: "12345678909", email: "maria.souza@email.com" };

const conflicted: DraftRecord = {
  id: "c2",
  entity: "client",
  data: mine,
  status: "conflict",
  errors: {},
  conflict: { current: { ...theirs, updatedAt: "2026-10-27T17:58:00+00:00" }, base: maria, collisions: [] },
  updatedAt: "2026-10-27T18:02:00.000Z",
};

function open(over: Partial<typeof EMPTY> = {}, id = "c2") {
  navigation.search = `?id=${id}`;
  local.value = { ...EMPTY, clients: [maria], drafts: [conflicted], ...over };
  return render(
    <AppShell>
      <ClientConflictScreen />
    </AppShell>,
  );
}

afterEach(() => {
  vi.mocked(resolveClientConflict).mockClear();
  navigation.back.mockReset();
  navigation.replace.mockReset();
  resetSyncStatus();
  resetSession();
});

describe("ClientConflictScreen", () => {
  it("só o campo que colidiu, com o rótulo do formulário, 'Antes' e o documento com a máscara", async () => {
    open();

    expect(await screen.findByRole("heading", { level: 1, name: "Conflito" })).toBeDefined();
    expect(screen.getByText(/^Maria Souza\. Ele foi alterado em outro aparelho/)).toBeDefined();
    const group = screen.getByRole("region", { name: "Cliente" });
    expect(within(group).getAllByRole("radiogroup")).toHaveLength(1);
    const field = within(group).getByRole("radiogroup", { name: "CPF ou CNPJ" });
    expect(within(group).getByText("Antes: 529.982.247-25")).toBeDefined();
    expect(within(field).getByRole("radio", { name: /Neste aparelho.*111\.444\.777-35/ })).toBeDefined();
    expect(within(field).getByRole("radio", { name: /No servidor.*123\.456\.789-09/ })).toBeDefined();
    expect(screen.getByText("0 de 1 campo resolvido")).toBeDefined();
    expect(screen.getByRole("button", { name: "Enviar resolução" }).hasAttribute("disabled")).toBe(true);
  });

  it("escolher o do servidor: a resolução leva o CPF de lá, o telefone daqui e o e-mail de lá", async () => {
    const user = userEvent.setup();
    window.history.pushState(null, "", "/clients/conflict?id=c2");
    open();

    await user.click(await screen.findByText("123.456.789-09"));
    await user.click(screen.getByRole("button", { name: "Enviar resolução" }));

    expect(resolveClientConflict).toHaveBeenCalledOnce();
    const [, { resolved, server }] = vi.mocked(resolveClientConflict).mock.calls[0]!;
    expect(resolved).toEqual({
      ...maria,
      version: "B",
      document: "12345678909",
      email: "maria.souza@email.com",
      phone: "(11) 98765-4321",
    });
    expect(server.version).toBe("B");
    expect(navigation.back).toHaveBeenCalledOnce();
  });

  it("nada mais em disputa (o formulário foi salvo com o valor do servidor): enviar sai direto", async () => {
    const user = userEvent.setup();
    open({ drafts: [{ ...conflicted, data: { ...mine, document: "12345678909" } }] });

    expect(await screen.findByText(/Nada mais em disputa/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Enviar resolução" }));

    expect(resolveClientConflict).toHaveBeenCalledOnce();
  });

  it("sem conflito para resolver: o aviso e 'Abrir o cliente'", () => {
    open({ drafts: [] });

    expect(screen.getByText("Este cliente não tem conflito para resolver.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Abrir o cliente" }).getAttribute("href")).toBe(
      "/clients/edit?id=c2",
    );
  });

  it("cliente que não está no aparelho: 'Voltar para a lista'", () => {
    open({ drafts: [], clients: [] }, "c9");

    expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe("/clients");
  });
});
