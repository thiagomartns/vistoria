import { useEffect, useState, useSyncExternalStore } from "react";

import { retryNow, syncStatusStore } from "./sync-status";
import { type OutboxItemView, describeSync } from "./sync-view";

// Os tempos relativos ("há 2 min") andam sozinhos, sem precisar de uma mudança no sync.
const CLOCK_MS = 30_000;

/**
 * O que o shell mostra do sync (SyncStatus, OfflineBanner, OutboxPanel) e o "Tentar agora". `actions`: o que pede a
 * pessoa fora da fila (os rascunhos em conflito).
 */
export function useSyncStatus(actions: readonly OutboxItemView[] = []) {
  const snapshot = useSyncExternalStore(
    syncStatusStore.subscribe,
    syncStatusStore.getSnapshot,
    syncStatusStore.getServerSnapshot,
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  return {
    ...describeSync(snapshot, now, actions),
    /** Transações na outbox, ou `null` enquanto ela não foi lida. */
    pending: snapshot.outboxRead ? snapshot.entries.length : null,
    retryNow,
  };
}
