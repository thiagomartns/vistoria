import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientRecord } from "@/features/clients/models/client";
import type { InspectionRecord } from "@/features/inspections/models/inspection";
import {
  deleteInspection,
  fetchInspection,
  saveInspection,
  saveInspectionDraft,
} from "@/features/inspections/services/inspections.sync";
import type { PropertyRecord } from "@/features/properties/models/property";
import { resetSession } from "@/shared/auth/session";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { FetchOutcome } from "@/shared/sync/fetch";
import { resetSyncStatus } from "@/shared/sync/sync-status";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { AppShell } from "../../app-shell";
import { InspectionEditScreen } from "./inspection-edit-screen";

// A tela de campo dentro do shell (Figma 43:1748, estados 0, 2, 3, 4 e 6), com o banco local simulado no hook e o
// rascunho e a fila espionados. Os debounces são os de verdade: 300 ms para o rascunho, 1,5 s para a fila.

const navigation = vi.hoisted(() => ({ search: "", push: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inspections/edit",
  useRouter: () => ({ push: navigation.push, replace: vi.fn<() => void>() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("@/features/local-store/hooks/useLocalOutbox", () => ({ useLocalOutbox: () => {} }));

const EMPTY = {
  store: { drafts: {} },
  ready: true,
  clients: [] as ClientRecord[],
  properties: [] as PropertyRecord[],
  inspections: [] as InspectionRecord[],
  drafts: [] as DraftRecord[],
  states: new Map<string, RecordSyncState>(),
  bases: new Map<string, Record<string, unknown> | undefined>(),
};

const local = vi.hoisted(() => ({ value: {} as typeof EMPTY }));

vi.mock("@/features/local-store/hooks/useLocalStore", () => ({
  useLocalStore: () => local.value,
}));

vi.mock("@/features/inspections/services/inspections.sync", () => ({
  saveInspection: vi.fn<() => string>(() => "i1"),
  saveInspectionDraft: vi.fn<() => void>(),
  deleteInspection: vi.fn<() => Promise<void>>(async () => {}),
  fetchInspection: vi.fn<(store: unknown, id: string) => Promise<FetchOutcome>>(
    async () => "not-found",
  ),
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

const item = (
  id: string,
  name: string,
  position: number,
  condition: InspectionRecord["rooms"][number]["items"][number]["condition"] = null,
  notes: string | null = null,
) => ({
  id,
  name,
  position,
  condition,
  notes,
});

const vistoria: InspectionRecord = {
  id: "i1",
  version: "AAAAAAAAB9O=",
  propertyId: "p1",
  kind: "moveIn",
  status: "inProgress",
  startedAt: new Date(2026, 9, 19, 9, 12).toISOString(),
  generalNotes: null,
  rooms: [
    {
      id: "r1",
      name: "Sala",
      position: 0,
      notes: null,
      items: [item("t1", "Piso", 0, "good"), item("t2", "Paredes", 1, "new")],
    },
    {
      id: "r2",
      name: "Cozinha",
      position: 1,
      notes: null,
      items: [
        item("t3", "Piso", 0, "good"),
        item("t4", "Paredes", 1, "fair", "Mancha de umidade atrás da geladeira."),
        item("t5", "Bancada", 2),
      ],
    },
    { id: "r3", name: "Varanda", position: 2, notes: null, items: [] },
  ],
};

function open(over: Partial<typeof EMPTY> = {}) {
  navigation.search = "?id=i1";
  local.value = { ...EMPTY, clients: [lar], properties: [apto], inspections: [vistoria], ...over };
  return render(
    <AppShell>
      <InspectionEditScreen />
    </AppShell>,
  );
}

const heading = () => screen.getByRole("heading", { level: 1 });
const steps = () => screen.getByRole("navigation", { name: "Ambientes" });
const chips = (name: string) => screen.getByRole("radiogroup", { name: `Condição: ${name}` });
const chip = (itemName: string, label: string) =>
  within(chips(itemName)).getByRole("radio", { name: label });
const currentStep = () => within(steps()).getByRole("button", { current: "step" });

const draftOf = (over: Partial<DraftRecord>): DraftRecord => ({
  id: "i1",
  entity: "inspection",
  data: vistoria,
  status: "draft",
  errors: {},
  updatedAt: "2026-10-26T13:00:00.000Z",
  ...over,
});

afterEach(() => {
  vi.mocked(saveInspection).mockClear();
  vi.mocked(saveInspectionDraft).mockClear();
  vi.mocked(deleteInspection).mockClear();
  vi.mocked(fetchInspection).mockReset().mockResolvedValue("not-found");
  navigation.push.mockClear();
  resetSyncStatus();
  resetSession();
});

describe("InspectionEditScreen", () => {
  it("estado 0: o endereço e o subtítulo no header, o primeiro ambiente e as etapas; modo foco, sem a barra inferior", () => {
    open();

    expect(heading().textContent).toBe("R. das Flores, 120 · Apto 302");
    expect(
      screen.getByText("Vistoria de entrada · Imobiliária Lar · iniciada em 19/10 às 09:12"),
    ).toBeDefined();
    expect(screen.getAllByRole("navigation", { name: "Principal" })).toHaveLength(1);
    expect(currentStep().textContent).toContain("Sala");
    expect(within(steps()).getByText("2 de 2")).toBeDefined();
    expect(within(steps()).getByText("2 de 3")).toBeDefined();
    expect(screen.getByText("1 de 3 concluídos")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Sala" })).toBeDefined();
    expect(screen.getByText("2 de 2 itens avaliados")).toBeDefined();
    expect(screen.getByText("Sala · 1 de 3")).toBeDefined();
    expect(chip("Piso", "Bom").getAttribute("aria-checked")).toBe("true");
    expect(chip("Paredes", "Novo").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Não enviado")).toBeNull();
  });

  it("observação com texto vem aberta; sem texto, sob demanda", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Próximo" }));

    expect((screen.getByLabelText("Observação: Paredes") as HTMLTextAreaElement).value).toBe(
      "Mancha de umidade atrás da geladeira.",
    );
    expect(screen.getByRole("button", { name: "Adicionar observação: Bancada" })).toBeDefined();
  });

  it("estado 2: ambiente sem itens mostra o EmptyState, sem ação; no último ambiente, Próximo desabilitado", async () => {
    const user = userEvent.setup();
    open();

    await user.click(within(steps()).getByRole("button", { name: /Varanda/ }));

    expect(screen.getByText("Nenhum item neste ambiente")).toBeDefined();
    expect(screen.getByText("Nenhum item ainda")).toBeDefined();
    expect(within(steps()).getByText("0 itens")).toBeDefined();
    expect((screen.getByRole("button", { name: "Próximo" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("marcar um chip: vai para o rascunho, depois para a fila, e o item fica 'Não enviado'", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Próximo" }));

    await user.click(chip("Bancada", "Ruim"));

    expect(chip("Bancada", "Ruim").getAttribute("aria-checked")).toBe("true");
    await vi.waitFor(() =>
      expect(vi.mocked(saveInspectionDraft).mock.lastCall?.[1].rooms[1]?.items[2]?.condition).toBe(
        "poor",
      ),
    );
    expect(vi.mocked(saveInspectionDraft).mock.lastCall?.[2]).toBe(1);
    expect(saveInspection).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(vi.mocked(saveInspection).mock.calls[0]?.[1].rooms[1]?.items[2]?.condition).toBe("poor");
    expect(screen.getByText("Não enviado")).toBeDefined();
  });

  it("logo depois de ir para a fila (antes de a outbox ser lida), o item segue 'Não enviado'; confirmado, some", async () => {
    const user = userEvent.setup();
    const view = open();
    await user.click(chip("Paredes", "Ruim"));
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });

    // O otimista já tem a mudança, e a outbox ainda não foi lida: sem base na fila.
    const optimistic = structuredClone(vistoria);
    optimistic.rooms[0]!.items[1]!.condition = "poor";
    local.value = { ...local.value, inspections: [optimistic] };
    view.rerender(
      <AppShell>
        <InspectionEditScreen />
      </AppShell>,
    );
    expect(screen.getByText("Não enviado")).toBeDefined();

    local.value = { ...local.value, inspections: [{ ...optimistic, version: "AAAAAAAAB9P=" }] };
    view.rerender(
      <AppShell>
        <InspectionEditScreen />
      </AppShell>,
    );
    expect(screen.queryByText("Não enviado")).toBeNull();
  });

  it("formulário sem mudança não vai para a fila, nem ao trocar de ambiente (ADR 0028)", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Próximo" }));
    await new Promise((done) => setTimeout(done, 1700));

    expect(saveInspection).not.toHaveBeenCalled();
    expect(saveInspectionDraft).toHaveBeenCalled();
    expect(vi.mocked(saveInspectionDraft).mock.lastCall?.[2]).toBe(1);
  });

  it("fechar a aba no meio de um ambiente e reabrir: o ambiente e os valores voltam do rascunho, e o que faltou vai para a fila", async () => {
    const changed = structuredClone(vistoria);
    changed.rooms[1]!.items[2]!.condition = "absent";
    open({ drafts: [draftOf({ data: changed, step: 1 })] });

    expect(currentStep().textContent).toContain("Cozinha");
    await vi.waitFor(() =>
      expect(chip("Bancada", "Ausente").getAttribute("aria-checked")).toBe("true"),
    );
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(vi.mocked(saveInspection).mock.calls[0]?.[1].rooms[1]?.items[2]?.condition).toBe(
      "absent",
    );
  });

  it("um merge sem colisão regrava o rascunho com a tela aberta: os chips passam a mostrar o mesclado, sem ir de novo para a fila", async () => {
    const view = open({ drafts: [draftOf({ step: 1 })] });
    await vi.waitFor(() =>
      expect(chip("Bancada", "Ausente").getAttribute("aria-checked")).toBe("false"),
    );

    const merged = structuredClone(vistoria);
    merged.rooms[1]!.items[2]!.condition = "absent";
    local.value = {
      ...local.value,
      drafts: [draftOf({ data: merged, step: 1, rebasedAt: "2026-10-27T09:00:00.000Z" })],
    };
    view.rerender(
      <AppShell>
        <InspectionEditScreen />
      </AppShell>,
    );

    await vi.waitFor(() =>
      expect(chip("Bancada", "Ausente").getAttribute("aria-checked")).toBe("true"),
    );
    await new Promise((done) => setTimeout(done, 1800));
    expect(saveInspection).not.toHaveBeenCalled();
  });

  describe("o pull traz a versão de outro aparelho com a tela aberta (ADR 0043)", () => {
    /** A vistoria como o outro aparelho a gravou: a Bancada passou a Ausente. */
    const remote = (): InspectionRecord => {
      const next = structuredClone(vistoria);
      next.rooms[1]!.items[2]!.condition = "absent";
      return { ...next, version: "AAAAAAAAB9P=" };
    };

    it("sem rascunho ainda: o registro muda, e os chips mostram o que o outro aparelho marcou, sem ir para a fila", async () => {
      const view = open();
      await userEvent.setup().click(screen.getByRole("button", { name: "Próximo" }));

      local.value = { ...local.value, inspections: [remote()] };
      view.rerender(
        <AppShell>
          <InspectionEditScreen />
        </AppShell>,
      );

      await vi.waitFor(() =>
        expect(chip("Bancada", "Ausente").getAttribute("aria-checked")).toBe("true"),
      );
      await vi.waitFor(() =>
        expect(
          vi.mocked(saveInspectionDraft).mock.lastCall?.[1].rooms[1]?.items[2]?.condition,
        ).toBe("absent"),
      );
      await new Promise((done) => setTimeout(done, 1700));
      expect(saveInspection).not.toHaveBeenCalled();
      expect(screen.queryByText("Não enviado")).toBeNull();
    });

    it("rascunho limpo regravado: o item do outro aparelho entra, e o que a pessoa acabou de marcar fica", async () => {
      const user = userEvent.setup();
      const view = open({ drafts: [draftOf({ step: 1 })] });
      await vi.waitFor(() => expect(currentStep().textContent).toContain("Cozinha"));

      // A marcação ainda não chegou ao rascunho (debounce de 300 ms) quando o pull o regrava.
      await user.click(chip("Piso", "Ruim"));
      const next = remote();
      local.value = {
        ...local.value,
        inspections: [next],
        drafts: [draftOf({ data: next, step: 1, rebasedAt: "2026-10-29T09:00:00.000Z" })],
      };
      view.rerender(
        <AppShell>
          <InspectionEditScreen />
        </AppShell>,
      );

      await vi.waitFor(() =>
        expect(chip("Bancada", "Ausente").getAttribute("aria-checked")).toBe("true"),
      );
      expect(chip("Piso", "Ruim").getAttribute("aria-checked")).toBe("true");
      await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
      const sent = vi.mocked(saveInspection).mock.calls[0]![1];
      expect(sent.rooms[1]?.items[0]?.condition).toBe("poor");
      expect(sent.rooms[1]?.items[2]?.condition).toBe("absent");
    });
  });

  it("estado 3 (offline, transação na fila): segue editável e uma mudança vai de novo para a fila (ADR 0021)", async () => {
    const user = userEvent.setup();
    open({
      states: new Map([["i1", "local"]]),
      bases: new Map([
        [
          "i1",
          {
            ...vistoria,
            rooms: [
              {
                ...vistoria.rooms[0],
                items: [item("t1", "Piso", 0), item("t2", "Paredes", 1, "new")],
              },
            ],
          },
        ],
      ]),
    });

    expect(within(screen.getByText("Piso").parentElement!).getByText("Não enviado")).toBeDefined();
    expect(screen.getAllByText("Não enviado")).toHaveLength(1);

    await user.click(chip("Paredes", "Ruim"));

    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(screen.getAllByText("Não enviado")).toHaveLength(2);
  });

  it("estado 4 (envio no ar): chips e observação só leitura, Anterior e Próximo ativos", async () => {
    const user = userEvent.setup();
    open({ states: new Map([["i1", "enviando"]]), bases: new Map([["i1", undefined]]) });

    expect((chip("Piso", "Novo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Adicionar observação/ })).toBeNull();
    expect(screen.getAllByText("Enviando").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Próximo" }));

    expect(currentStep().textContent).toContain("Cozinha");
    expect((screen.getByLabelText("Observação: Paredes") as HTMLTextAreaElement).readOnly).toBe(
      true,
    );
  });

  it("estado 6: 400 num item volta ao chip certo, no ambiente certo, com 'Revisar' e o aviso", async () => {
    const sent = structuredClone(vistoria);
    open({
      drafts: [
        draftOf({
          data: sent,
          status: "rejected",
          step: 0,
          errors: { "rooms[1].items[2].condition": ["Escolha a condição."] },
        }),
      ],
    });

    expect(currentStep().textContent).toContain("Cozinha");
    const message = await screen.findByText("Escolha a condição.");
    expect(chips("Bancada").getAttribute("aria-invalid")).toBe("true");
    expect(chips("Piso").getAttribute("aria-invalid")).toBe("false");
    expect(message.closest("[data-slot=form-item]")?.contains(chips("Bancada"))).toBe(true);
    expect(screen.getByText("Revisar")).toBeDefined();
    expect(currentStep().textContent).toContain("1 erro");
    expect(screen.getByText("O servidor recusou esta vistoria")).toBeDefined();
    expect(
      screen.getByText("Cozinha: 1 item precisa de correção. Corrija e ela é enviada de novo."),
    ).toBeDefined();
    expect(within(heading().closest("header")!).getByText("Correção necessária")).toBeDefined();
  });

  it("corrigir o chip recusado tira o erro e manda de novo para a fila", async () => {
    const user = userEvent.setup();
    open({
      drafts: [
        draftOf({
          status: "rejected",
          step: 1,
          errors: { "rooms[1].items[2].condition": ["Escolha a condição."] },
        }),
      ],
    });
    await screen.findByText("Escolha a condição.");

    await user.click(chip("Bancada", "Bom"));

    expect(screen.queryByText("Escolha a condição.")).toBeNull();
    expect(chips("Bancada").getAttribute("aria-invalid")).toBe("false");
    await vi.waitFor(() => expect(saveInspection).toHaveBeenCalledOnce(), { timeout: 3000 });
  });

  it("recusada e reaberta sem mudança: não volta sozinha para a fila, mesmo com o otimista desfeito", async () => {
    const sent = structuredClone(vistoria);
    sent.rooms[0]!.items[1]!.condition = "poor";
    open({
      drafts: [
        draftOf({
          data: sent,
          status: "rejected",
          errors: { "rooms[1].items[2].condition": ["Escolha a condição."] },
        }),
      ],
    });
    await screen.findByText("Escolha a condição.");

    await new Promise((done) => setTimeout(done, 1700));

    expect(saveInspection).not.toHaveBeenCalled();
    expect(screen.getByText("Escolha a condição.")).toBeDefined();
  });

  it("recusa numa chave fora do formulário: o aviso traz a mensagem do servidor", async () => {
    open({
      drafts: [draftOf({ status: "rejected", errors: { propertyId: ["Imóvel não encontrado."] } })],
    });

    expect(await screen.findByText("Imóvel não encontrado.")).toBeDefined();
    expect(screen.getByText("O servidor recusou esta vistoria")).toBeDefined();
  });

  describe("estado 5: conflito", () => {
    // Aqui, Paredes da Cozinha ficou Ruim; no outro aparelho, Ausente. O resto mesclou sozinho.
    const mine = structuredClone(vistoria);
    mine.rooms[1]!.items[1]!.condition = "poor";
    const theirs = structuredClone(vistoria);
    theirs.rooms[1]!.items[1]!.condition = "absent";
    const conflicted = () =>
      draftOf({
        data: mine,
        status: "conflict",
        step: 1,
        conflict: { current: { ...theirs, version: "V2" }, base: vistoria, collisions: [] },
      });

    it("o aviso com 'Resolver conflito' para o resolver desta vistoria, a etapa e o item em conflito", async () => {
      open({ drafts: [conflicted()] });

      expect(await screen.findByText("Esta vistoria foi alterada em outro aparelho")).toBeDefined();
      expect(
        screen.getByText(
          "Suas alterações estão salvas neste aparelho. Escolha o que fica em cada campo para enviar de novo.",
        ),
      ).toBeDefined();
      expect(screen.getByRole("link", { name: "Resolver conflito" }).getAttribute("href")).toBe(
        "/inspections/conflict?id=i1",
      );
      expect(currentStep().textContent).toContain("Conflito");
      const paredes = chips("Paredes").closest("[data-slot=form-item]") as HTMLElement;
      expect(within(paredes).getByText("Em conflito")).toBeDefined();
      expect(chip("Paredes", "Ruim").getAttribute("aria-checked")).toBe("true");
      expect(within(heading().closest("header")!).getByText("Conflito")).toBeDefined();
    });

    it("reaberta sem mudança, não volta sozinha para a fila (o 412 voltaria a cada abertura)", async () => {
      open({ drafts: [conflicted()] });
      await screen.findByText("Esta vistoria foi alterada em outro aparelho");

      await new Promise((done) => setTimeout(done, 1700));

      expect(saveInspection).not.toHaveBeenCalled();
    });

    it("segue editável: a mudança vai para o rascunho e não para a fila; o envio é pelo resolver", async () => {
      const user = userEvent.setup();
      open({ drafts: [conflicted()] });
      await screen.findByText("Esta vistoria foi alterada em outro aparelho");

      await user.click(chip("Bancada", "Bom"));

      await vi.waitFor(() =>
        expect(vi.mocked(saveInspectionDraft).mock.lastCall?.[1]).toMatchObject({
          rooms: [{}, { items: [{}, { condition: "poor" }, { condition: "good" }] }, {}],
        }),
      );
      await new Promise((done) => setTimeout(done, 1700));
      expect(saveInspection).not.toHaveBeenCalled();
    });
  });

  it("excluir (#107): o ··· do header, o Dialog com a alteração não enviada; confirmada, a tela volta à lista e nada mais vai para a fila", async () => {
    const user = userEvent.setup();
    const view = open();
    await user.click(chip("Paredes", "Ruim"));

    const header = screen.getByRole("banner");
    await user.click(within(header).getByRole("button", { name: "Mais ações" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir vistoria" }));
    const dialog = screen.getByRole("dialog", { name: "Excluir esta vistoria?" });
    expect(dialog.textContent).toContain(
      "R. das Flores, 120 · Apto 302 · Vistoria de entrada. Ela sai deste aparelho e do servidor, e não dá para desfazer. As alterações ainda não enviadas também são descartadas. Sem rede, a exclusão sai quando a conexão voltar.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Excluir vistoria" }));

    await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/inspections"));
    expect(deleteInspection).toHaveBeenCalledWith(local.value.store, "i1");
    const drafted = vi.mocked(saveInspectionDraft).mock.calls.length;
    view.unmount();
    await new Promise((done) => setTimeout(done, 1700));
    expect(saveInspection).not.toHaveBeenCalled();
    expect(vi.mocked(saveInspectionDraft).mock.calls).toHaveLength(drafted);
  });

  it("sincronizada e sem mudança: o Dialog não fala de alteração não enviada", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Mais ações" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir vistoria" }));

    expect(screen.getByRole("dialog").textContent).not.toContain("não enviadas");
  });

  it("concluída: sem o ···", () => {
    open({ inspections: [{ ...vistoria, status: "completed" }] });

    expect(screen.queryByRole("button", { name: "Mais ações" })).toBeNull();
  });

  it("estado 6 do #107 (exclusão na fila): só leitura, com o aviso, 'Excluindo' e sem o ···", () => {
    // Uma edição já tentada ainda está na fila, antes da exclusão: o item não fica "Não enviado".
    const edited = structuredClone(vistoria);
    edited.rooms[0]!.items[1]!.condition = "poor";
    open({
      inspections: [{ ...edited, deleting: true }],
      states: new Map([["i1", "local"]]),
      bases: new Map([["i1", vistoria]]),
    });

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Exclusão aguardando envio");
    expect(notice.textContent).toContain("Esta vistoria será excluída quando a conexão voltar.");
    expect((chip("Piso", "Novo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Excluindo")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Mais ações" })).toBeNull();
    expect(screen.queryByText("Não enviado")).toBeNull();
  });

  it("excluída em outro aparelho (#109): o aviso do tipo excluído com 'Resolver conflito', e segue editável", () => {
    open({
      drafts: [
        draftOf({
          data: vistoria,
          status: "conflict",
          step: 0,
          conflict: { type: "deleted", current: undefined, base: vistoria, collisions: [] },
        }),
      ],
    });

    expect(screen.getByText("Esta vistoria foi excluída em outro aparelho")).toBeDefined();
    expect(screen.getByRole("link", { name: "Resolver conflito" }).getAttribute("href")).toBe(
      "/inspections/conflict?id=i1",
    );
    expect((chip("Piso", "Novo") as HTMLButtonElement).disabled).toBe(false);
  });

  it("exclusão alterada (#109): só leitura, com o que o servidor tem, o aviso com 'Resolver conflito' e sem o ···", () => {
    const theirs = structuredClone(vistoria);
    theirs.rooms[0]!.items[0]!.condition = "absent";
    theirs.version = "V9";
    open({
      inspections: [theirs],
      drafts: [
        draftOf({
          data: theirs,
          status: "conflict",
          conflict: { type: "removal", current: theirs, collisions: [] },
        }),
      ],
    });

    expect(screen.getByText("Esta vistoria foi alterada antes da exclusão")).toBeDefined();
    expect(screen.getByRole("link", { name: "Resolver conflito" }).getAttribute("href")).toBe(
      "/inspections/conflict?id=i1",
    );
    expect(chip("Piso", "Ausente").getAttribute("aria-checked")).toBe("true");
    expect((chip("Piso", "Novo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Mais ações" })).toBeNull();
  });

  describe("vistoria que não está no aparelho (leitura por id)", () => {
    it("busca no servidor e, enquanto busca, fica carregando", () => {
      vi.mocked(fetchInspection).mockReturnValue(new Promise(() => {}));
      open({ inspections: [] });

      expect(vi.mocked(fetchInspection)).toHaveBeenCalledWith(local.value.store, "i1");
      expect(heading().textContent).toBe("Vistoria");
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("navigation", { name: "Ambientes" })).toBeNull();
    });

    it("a que está no aparelho (ou só no rascunho) não é buscada", () => {
      open();
      open({ inspections: [], drafts: [draftOf({ status: "rejected" })] });

      expect(vi.mocked(fetchInspection)).not.toHaveBeenCalled();
    });

    it("gravada pela busca, abre a tela de campo com o imóvel e o cliente", async () => {
      vi.mocked(fetchInspection).mockResolvedValue("found");
      const { rerender } = open({ clients: [], properties: [], inspections: [] });
      await vi.waitFor(() => expect(vi.mocked(fetchInspection)).toHaveBeenCalledOnce());

      // O banco local entrega o que a busca gravou: o cliente, o imóvel e a vistoria.
      local.value = { ...local.value, clients: [lar], properties: [apto], inspections: [vistoria] };
      rerender(
        <AppShell>
          <InspectionEditScreen />
        </AppShell>,
      );

      expect(
        await screen.findByRole("heading", { level: 1, name: "R. das Flores, 120 · Apto 302" }),
      ).toBeDefined();
      expect(screen.getByText(/Imobiliária Lar/)).toBeDefined();
      expect(screen.getByRole("heading", { level: 2, name: "Sala" })).toBeDefined();
    });

    it("404: não encontrada, com a volta para a lista", async () => {
      open({ inspections: [] });

      expect(await screen.findByText("Esta vistoria não existe ou foi excluída.")).toBeDefined();
      expect(screen.getByRole("link", { name: "Voltar para a lista" }).getAttribute("href")).toBe(
        "/inspections",
      );
    });

    it("sem rede: explica que é preciso abrir uma vez com internet", async () => {
      vi.mocked(fetchInspection).mockResolvedValue("offline");
      open({ inspections: [] });

      expect(
        await screen.findByText(
          "Esta vistoria ainda não está neste aparelho. Abra-a uma vez com internet para trabalhar nela offline.",
        ),
      ).toBeDefined();
    });

    it("falha do servidor: Tentar de novo busca outra vez", async () => {
      const user = userEvent.setup();
      vi.mocked(fetchInspection).mockResolvedValue("failed");
      open({ inspections: [] });

      await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));

      expect(screen.getByText("Não foi possível buscar esta vistoria agora.")).toBeDefined();
      await vi.waitFor(() => expect(vi.mocked(fetchInspection)).toHaveBeenCalledTimes(2));
    });
  });
});
