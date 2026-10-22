import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useSession } from "@/shared/auth/useSession";
import { syncStatusStore } from "@/shared/sync/sync-status";
import { recordSyncStates } from "@/shared/sync/sync-view";

import { type ClientsStore, openClientsStore } from "../services/clients.sync";

/**
 * O banco local de clients do dono da sessão: os clients (otimistas incluídos), os rascunhos recusados e o estado
 * de sync de cada registro com transação na outbox. `ready` só quando as duas collections já carregaram.
 */
export function useClientsStore() {
  const ownerId = useSession().user?.id;
  const [store, setStore] = useState<ClientsStore>();

  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    void openClientsStore(ownerId).then((opened) => {
      if (active) setStore(opened);
    });
    return () => {
      active = false;
      setStore(undefined);
    };
  }, [ownerId]);

  const clients = useLiveQuery(() => store?.clients, [store]);
  const drafts = useLiveQuery(() => store?.drafts, [store]);
  const snapshot = useSyncExternalStore(
    syncStatusStore.subscribe,
    syncStatusStore.getSnapshot,
    syncStatusStore.getServerSnapshot,
  );

  return {
    store,
    ready: store !== undefined && clients.isReady && drafts.isReady,
    clients: clients.data ?? [],
    drafts: drafts.data ?? [],
    states: recordSyncStates(snapshot),
  };
}
