import { useEffect } from "react";

import { useSession } from "@/shared/auth/useSession";

import { openClientsStore } from "../services/clients.sync";

/**
 * Abre a outbox de clients do dono da sessão, para as transações pendentes voltarem à fila e aparecerem no
 * SyncStatus (e no SessionExpired do /login). Sem dono, não abre nada. Fica no shell até a outbox única de clients
 * e properties (#74).
 */
export function useClientsOutbox(): void {
  const ownerId = useSession().user?.id;

  useEffect(() => {
    if (ownerId) void openClientsStore(ownerId);
  }, [ownerId]);
}
