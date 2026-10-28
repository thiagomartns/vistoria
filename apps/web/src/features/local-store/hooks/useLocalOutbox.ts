import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useState } from "react";

import { useSession } from "@/shared/auth/useSession";
import { type OutboxItemView, conflictItems } from "@/shared/sync/sync-view";

import { type LocalStore, openLocalStore } from "../services/local-store";

/**
 * Abre o banco local e a outbox do dono da sessão, para as transações pendentes voltarem à fila e aparecerem no
 * SyncStatus (e no SessionExpired do /login) em qualquer tela do shell. Sem dono, não abre nada. Devolve os rascunhos
 * em conflito, que já saíram da fila e entram em "Ação necessária" no OutboxPanel.
 */
export function useLocalOutbox(): OutboxItemView[] {
  const ownerId = useSession().user?.id;
  const [store, setStore] = useState<LocalStore>();

  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    void openLocalStore(ownerId).then((opened) => {
      if (active) setStore(opened);
    });
    return () => {
      active = false;
      setStore(undefined);
    };
  }, [ownerId]);

  const drafts = useLiveQuery(() => store?.drafts, [store]);
  return conflictItems(drafts.data ?? []);
}
