import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useState } from "react";

import type { ClientRecord } from "../models/client";
import { useSession } from "@/shared/auth/useSession";

import { type ClientsStore, openClientsStore, saveClient } from "../services/clients.sync";

/** Uma transação da outbox, do jeito que a tela mostra. */
export interface PendingWrite {
  id: string;
  idempotencyKey: string;
  recordId: string;
  retryCount: number;
  lastError: string | null;
}

// A outbox não avisa quando muda; a página de prova relê em intervalo curto.
const OUTBOX_POLL_MS = 300;

/** Clients do banco local do dono da sessão (otimistas incluídos), as transações pendentes e a escrita. */
export function useClients() {
  const ownerId = useSession().user?.id;
  const [store, setStore] = useState<ClientsStore>();
  const [pending, setPending] = useState<PendingWrite[]>([]);

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

  useEffect(() => {
    if (!store) return;
    const read = async () => {
      const entries = await store.outbox.peekOutbox();
      setPending(
        entries.map((entry) => ({
          id: entry.id,
          idempotencyKey: entry.idempotencyKey,
          recordId: String(entry.mutations[0]?.key ?? ""),
          retryCount: entry.retryCount,
          lastError: entry.lastError?.message ?? null,
        })),
      );
    };
    void read();
    const timer = setInterval(() => void read(), OUTBOX_POLL_MS);
    return () => clearInterval(timer);
  }, [store]);

  const { data } = useLiveQuery(() => store?.clients, [store]);

  return {
    ready: store !== undefined,
    clients: (data ?? []) as ClientRecord[],
    pending,
    save: (values: Omit<ClientRecord, "id"> & { id?: string }) =>
      store ? saveClient(store, values) : undefined,
  };
}
