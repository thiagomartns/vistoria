// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { OutboxEntry, SyncSnapshot } from "./sync-status";
import {
  STUCK_AFTER_MS,
  calendarTime,
  describeSync,
  registerRecordLabel,
  relativeTime,
} from "./sync-view";

const now = new Date(2026, 9, 22, 14, 32);
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

registerRecordLabel("upsertTest", (record) => `Cliente · ${String(record.name)}`);

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: crypto.randomUUID(),
  mutationFnName: "upsertTest",
  record: { name: "Maria" },
  createdAt: minutesAgo(5),
  retryCount: 0,
  nextAttemptAt: now.getTime(),
  ...over,
});

const snapshot = (over: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  online: true,
  entries: [],
  running: 0,
  lastSyncedAt: null,
  ...over,
});

describe("describeSync: SyncStatus", () => {
  it("sincronizado: neutro, com o último envio relativo", () => {
    const { status, offline } = describeSync(snapshot({ lastSyncedAt: minutesAgo(2) }), now);

    expect(status).toEqual({
      state: "sincronizado",
      label: "Sincronizado",
      detail: "há 2 min",
      compactLabel: "Sincronizado",
    });
    expect(offline).toBe(false);
  });

  it("sincronizado sem nenhum envio ainda: sem detalhe", () => {
    expect(describeSync(snapshot(), now).status.detail).toBeNull();
  });

  it("enviando: online com pendências", () => {
    const { status } = describeSync(snapshot({ entries: [entry(), entry(), entry()] }), now);

    expect(status).toEqual({
      state: "enviando",
      label: "Enviando",
      detail: "3 alterações",
      compactLabel: "Enviando 3",
    });
  });

  it("offline com pendências: contagem no rótulo compacto e banner", () => {
    const view = describeSync(snapshot({ online: false, entries: [entry()] }), now);

    expect(view.status).toEqual({
      state: "offline",
      label: "Offline",
      detail: "1 pendente",
      compactLabel: "Offline · 1",
    });
    expect(view.offline).toBe(true);
  });

  it("offline sem pendências: sem contagem", () => {
    const { status } = describeSync(snapshot({ online: false }), now);

    expect([status.detail, status.compactLabel]).toEqual([null, "Offline"]);
  });
});

describe("describeSync: OutboxPanel", () => {
  it("descreve as pendências e o último sync", () => {
    const view = describeSync(
      snapshot({ entries: [entry(), entry()], lastSyncedAt: new Date(2026, 9, 22, 14, 30) }),
      now,
    );

    expect(view.panel.description).toBe(
      "2 alterações ainda não chegaram ao servidor. Último sync: hoje, 14:30.",
    );
  });

  it("vazio: tudo sincronizado, e diz quando nunca houve envio", () => {
    expect(describeSync(snapshot(), now).panel).toEqual({
      description: "Tudo sincronizado. Último sync: nenhum ainda.",
      actionNeeded: [],
      failing: [],
      waiting: [],
    });
  });

  it("pendente nunca tentada: na fila, com a hora em que entrou", () => {
    const [item] = describeSync(snapshot({ entries: [entry()] }), now).panel.waiting;

    expect(item).toMatchObject({
      state: "pendente",
      title: "Cliente · Maria",
      detail: "Na fila · nunca enviada · 14:27",
    });
  });

  it("pendente que já falhou: próxima tentativa e quantas houve", () => {
    const failed = entry({ retryCount: 3, nextAttemptAt: new Date(2026, 9, 22, 14, 40).getTime() });

    const [item] = describeSync(snapshot({ entries: [failed] }), now).panel.waiting;

    expect(item).toMatchObject({
      state: "pendente",
      detail: "Nova tentativa às 14:40 · 3 tentativas",
    });
  });

  it("enviando: as mais antigas, uma por execução em andamento", () => {
    const entries = [entry({ createdAt: minutesAgo(9) }), entry({ createdAt: minutesAgo(3) })];

    const { waiting } = describeSync(snapshot({ entries, running: 1 }), now).panel;

    expect(waiting.map((i) => i.state)).toEqual(["enviando", "pendente"]);
    expect(waiting[0]?.detail).toBe("Enviando…");
  });

  it("offline nada está sendo enviado, mesmo com execução registrada", () => {
    const { waiting } = describeSync(
      snapshot({ online: false, entries: [entry()], running: 1 }),
      now,
    ).panel;

    expect(waiting[0]?.state).toBe("pendente");
  });

  it("travada: falhando há mais de 24 h vai para falha no envio", () => {
    const old = new Date(now.getTime() - STUCK_AFTER_MS - 60_000);
    const stuck = entry({ retryCount: 40, createdAt: old });
    const young = entry({ retryCount: 2, createdAt: minutesAgo(30) });

    const { failing, waiting } = describeSync(snapshot({ entries: [stuck, young] }), now).panel;

    expect(failing).toEqual([
      {
        id: stuck.id,
        state: "travada",
        title: "Cliente · Maria",
        detail: `Nova tentativa automática. Na fila desde ${calendarTime(old, now)}.`,
      },
    ]);
    expect(waiting.map((i) => i.id)).toEqual([young.id]);
  });

  it("sem rótulo registrado para a mutationFn: título genérico", () => {
    const [item] = describeSync(snapshot({ entries: [entry({ mutationFnName: "outra" })] }), now)
      .panel.waiting;

    expect(item?.title).toBe("Alteração");
  });
});

describe("tempos", () => {
  it.each([
    [0, "agora"],
    [1, "há 1 min"],
    [59, "há 59 min"],
    [60, "há 1 h"],
    [23 * 60 + 59, "há 23 h"],
  ])("%i min atrás → %s", (minutes, text) => {
    expect(relativeTime(minutesAgo(minutes), now)).toBe(text);
  });

  it("mais de um dia: a data", () => {
    expect(relativeTime(new Date(2026, 9, 20, 9, 0), now)).toBe("em 20/10");
  });

  it("calendário: hoje, ontem ou a data", () => {
    expect(calendarTime(new Date(2026, 9, 22, 8, 5), now)).toBe("hoje, 08:05");
    expect(calendarTime(new Date(2026, 9, 21, 23, 50), now)).toBe("ontem, 23:50");
    expect(calendarTime(new Date(2026, 9, 2, 10, 0), now)).toBe("02/10, 10:00");
  });
});
