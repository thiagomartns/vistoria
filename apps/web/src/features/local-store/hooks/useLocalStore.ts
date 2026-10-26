import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useSession } from "@/shared/auth/useSession";
import { syncStatusStore } from "@/shared/sync/sync-status";
import { confirmedBases, recordSyncStates } from "@/shared/sync/sync-view";

import { type LocalStore, openLocalStore } from "../services/local-store";

/**
 * O banco local do dono da sessão: clients, properties e inspections (otimistas incluídos), os rascunhos e o estado de
 * sync de cada registro com transação na outbox, com a base confirmada dele. `ready` só quando todas as collections já
 * carregaram.
 */
export function useLocalStore() {
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

  const clients = useLiveQuery(() => store?.clients, [store]);
  const properties = useLiveQuery(() => store?.properties, [store]);
  const inspections = useLiveQuery(() => store?.inspections, [store]);
  const drafts = useLiveQuery(() => store?.drafts, [store]);
  const snapshot = useSyncExternalStore(
    syncStatusStore.subscribe,
    syncStatusStore.getSnapshot,
    syncStatusStore.getServerSnapshot,
  );

  return {
    store,
    ready:
      store !== undefined &&
      clients.isReady &&
      properties.isReady &&
      inspections.isReady &&
      drafts.isReady,
    clients: clients.data ?? [],
    properties: properties.data ?? [],
    inspections: inspections.data ?? [],
    drafts: drafts.data ?? [],
    states: recordSyncStates(snapshot),
    /** O que o servidor confirmou de cada registro com transação na fila (vazio numa criação). */
    bases: confirmedBases(snapshot),
  };
}
