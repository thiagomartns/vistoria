import type { Outbox } from "./outbox";

// Estado do sync que o shell mostra (frontend.md, "UX de sincronização"): rede, transações da outbox e o último
// envio confirmado. Sem React: o hook useSyncStatus lê daqui. A outbox não avisa quando muda, então é lida em
// intervalo, como a página de prova do spike 1a fazia.

/** Uma transação da outbox, só com o que a tela precisa. */
export interface OutboxEntry {
  id: string;
  mutationFnName: string;
  /** O registro enviado (o `modified` da mutação), para dar nome ao item. */
  record: Record<string, unknown> | undefined;
  createdAt: Date;
  retryCount: number;
  nextAttemptAt: number;
}

export interface SyncSnapshot {
  online: boolean;
  /** Na ordem em que serão enviadas (a mais antiga primeiro). */
  entries: OutboxEntry[];
  /** Transações sendo enviadas agora. */
  running: number;
  lastSyncedAt: Date | null;
}

const OUTBOX_POLL_MS = 1000;

const INITIAL: SyncSnapshot = { online: true, entries: [], running: 0, lastSyncedAt: null };

let snapshot = INITIAL;
let outbox: Outbox | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function update(next: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

const onOnline = () => update({ online: true });
const onOffline = () => update({ online: false });

async function readOutbox() {
  if (!outbox) return;
  const entries: OutboxEntry[] = (await outbox.peekOutbox())
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((entry) => ({
      id: entry.id,
      mutationFnName: entry.mutationFnName,
      record: entry.mutations[0]?.modified as Record<string, unknown> | undefined,
      createdAt: new Date(entry.createdAt),
      retryCount: entry.retryCount,
      nextAttemptAt: entry.nextAttemptAt,
    }));
  const running = outbox.getRunningCount();
  if (running !== snapshot.running || !sameEntries(entries, snapshot.entries)) {
    update({ entries, running });
  }
}

function sameEntries(a: OutboxEntry[], b: OutboxEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, i) =>
        entry.id === b[i]?.id &&
        entry.retryCount === b[i]?.retryCount &&
        entry.nextAttemptAt === b[i]?.nextAttemptAt,
    )
  );
}

function start() {
  if (typeof window === "undefined" || timer !== undefined) return;
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  update({ online: navigator.onLine });
  void readOutbox();
  timer = setInterval(() => void readOutbox(), OUTBOX_POLL_MS);
}

function stop() {
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  clearInterval(timer);
  timer = undefined;
}

/** Store para o `useSyncExternalStore`. Escuta a rede e lê a outbox só enquanto alguém assina. */
export const syncStatusStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },
  getSnapshot: (): SyncSnapshot => snapshot,
  getServerSnapshot: (): SyncSnapshot => INITIAL,
};

/** A outbox que o shell acompanha. Chamado por quem a abre. */
export function trackOutbox(target: Outbox): void {
  outbox = target;
  void readOutbox();
}

/** Marca um envio confirmado pelo servidor ("Último sync"). Chamado pela mutationFn depois do 2xx. */
export function recordSyncSuccess(at: Date = new Date()): void {
  update({ lastSyncedAt: at });
}

/** Acorda a fila agora, sem esperar o backoff ("Tentar agora"). */
export function retryNow(): void {
  outbox?.getOnlineDetector().notifyOnline();
}

/** Volta ao estado inicial. Só para testes. */
export function resetSyncStatus(): void {
  if (timer !== undefined) stop();
  outbox = undefined;
  listeners.clear();
  snapshot = INITIAL;
}
