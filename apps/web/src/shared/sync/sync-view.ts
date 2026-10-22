import type { OutboxEntry, SyncSnapshot } from "./sync-status";

// Do estado do sync para o que o shell mostra: SyncStatus, OfflineBanner e OutboxPanel (frame "Shell (#7)").
// Função pura, para cada estado caber num teste. Os componentes recebem só o resultado.

export type SyncStatusState = "sincronizado" | "enviando" | "offline" | "requer-acao";
export type OutboxItemState = "pendente" | "enviando" | "travada" | "conflito" | "rejeitada";

export interface OutboxItemView {
  id: string;
  state: OutboxItemState;
  title: string;
  detail: string;
}

export interface SyncView {
  status: {
    state: SyncStatusState;
    /** Rótulo e detalhe do tamanho completo (desktop). */
    label: string;
    detail: string | null;
    /** Rótulo do tamanho compacto (celular), sem detalhe. */
    compactLabel: string;
  };
  offline: boolean;
  panel: {
    description: string;
    actionNeeded: OutboxItemView[];
    failing: OutboxItemView[];
    waiting: OutboxItemView[];
  };
}

/** Pendência "travada": 24 h falhando sem sucesso (backend.md, "Parâmetros compartilhados"). */
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

type RecordLabel = (record: Record<string, unknown>) => string;

const recordLabels = new Map<string, RecordLabel>();

/** Como a feature nomeia um registro da sua mutationFn no painel ("Cliente · Maria Locadora"). */
export function registerRecordLabel(mutationFnName: string, label: RecordLabel): void {
  recordLabels.set(mutationFnName, label);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const time = (date: Date) =>
  date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "agora", "há 5 min", "há 2 h", "em 20/10". */
export function relativeTime(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60) return `há ${Math.floor(minutes / 60)} h`;
  return `em ${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

/** "hoje, 14:30", "ontem, 14:30" ou "20/10, 14:30". */
export function calendarTime(date: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = sameDay(date, now)
    ? "hoje"
    : sameDay(date, yesterday)
      ? "ontem"
      : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${day}, ${time(date)}`;
}

function titleOf(entry: OutboxEntry): string {
  const label = recordLabels.get(entry.mutationFnName);
  return label && entry.record ? label(entry.record) : "Alteração";
}

function itemOf(entry: OutboxEntry, sending: boolean, now: Date): OutboxItemView {
  const base = { id: entry.id, title: titleOf(entry) };
  const failing = entry.retryCount > 0;
  if (failing && now.getTime() - entry.createdAt.getTime() > STUCK_AFTER_MS) {
    return {
      ...base,
      state: "travada",
      detail: `Nova tentativa automática. Na fila desde ${calendarTime(entry.createdAt, now)}.`,
    };
  }
  if (sending) return { ...base, state: "enviando", detail: "Enviando…" };
  if (failing) {
    return {
      ...base,
      state: "pendente",
      detail: `Nova tentativa às ${time(new Date(entry.nextAttemptAt))} · ${plural(entry.retryCount, "tentativa", "tentativas")}`,
    };
  }
  return {
    ...base,
    state: "pendente",
    detail: `Na fila · nunca enviada · ${time(entry.createdAt)}`,
  };
}

export function describeSync(snapshot: SyncSnapshot, now: Date): SyncView {
  const { online, entries, running, lastSyncedAt } = snapshot;
  const pending = entries.length;

  // A execução vai da mais antiga para a mais nova: as `running` primeiras ainda não travadas estão no ar.
  let sendingLeft = online ? running : 0;
  const items = entries.map((entry) => {
    const item = itemOf(entry, sendingLeft > 0, now);
    if (item.state === "enviando") sendingLeft--;
    return item;
  });

  // Conflito e rejeitada ainda não ficam na outbox: a reação a eles chega no M3. O grupo já existe.
  const actionNeeded = items.filter((i) => i.state === "conflito" || i.state === "rejeitada");
  const failing = items.filter((i) => i.state === "travada");
  const waiting = items.filter((i) => i.state === "pendente" || i.state === "enviando");

  const lastSync = lastSyncedAt
    ? `Último sync: ${calendarTime(lastSyncedAt, now)}.`
    : "Último sync: nenhum ainda.";
  const description =
    pending === 0
      ? `Tudo sincronizado. ${lastSync}`
      : `${plural(pending, "alteração ainda não chegou", "alterações ainda não chegaram")} ao servidor. ${lastSync}`;

  return {
    status: statusOf({ online, pending, needsAction: actionNeeded.length, lastSyncedAt, now }),
    offline: !online,
    panel: { description, actionNeeded, failing, waiting },
  };
}

function statusOf({
  online,
  pending,
  needsAction,
  lastSyncedAt,
  now,
}: {
  online: boolean;
  pending: number;
  needsAction: number;
  lastSyncedAt: Date | null;
  now: Date;
}): SyncView["status"] {
  if (needsAction > 0) {
    return {
      state: "requer-acao",
      label: "Requer ação",
      detail: `${needsAction} ${needsAction === 1 ? "precisa" : "precisam"} de você`,
      compactLabel: `Requer ação · ${needsAction}`,
    };
  }
  if (!online) {
    return {
      state: "offline",
      label: "Offline",
      detail: pending > 0 ? plural(pending, "pendente", "pendentes") : null,
      compactLabel: pending > 0 ? `Offline · ${pending}` : "Offline",
    };
  }
  if (pending > 0) {
    return {
      state: "enviando",
      label: "Enviando",
      detail: plural(pending, "alteração", "alterações"),
      compactLabel: `Enviando ${pending}`,
    };
  }
  return {
    state: "sincronizado",
    label: "Sincronizado",
    detail: lastSyncedAt ? relativeTime(lastSyncedAt, now) : null,
    compactLabel: "Sincronizado",
  };
}

/** Estado de sync de um registro com transação na outbox (SyncBadge da linha e do cabeçalho). */
export type RecordSyncState = "local" | "enviando";

/**
 * O estado de cada registro que tem transação na outbox, pelo `id` do registro enviado. Sem transação, o registro
 * está sincronizado (não entra no mapa). Mesma regra do painel: as `running` mais antigas estão no ar, só online.
 */
export function recordSyncStates(snapshot: SyncSnapshot): Map<string, RecordSyncState> {
  const states = new Map<string, RecordSyncState>();
  let sendingLeft = snapshot.online ? snapshot.running : 0;
  for (const entry of snapshot.entries) {
    const sending = sendingLeft > 0;
    sendingLeft--;
    const id = entry.record?.id;
    if (typeof id !== "string") continue;
    if (sending) states.set(id, "enviando");
    else if (!states.has(id)) states.set(id, "local");
  }
  return states;
}
