import { useEffect } from "react";

import { useSession } from "@/shared/auth/useSession";

import { openLocalStore } from "../services/local-store";

/**
 * Abre o banco local e a outbox do dono da sessão, para as transações pendentes voltarem à fila e aparecerem no
 * SyncStatus (e no SessionExpired do /login) em qualquer tela do shell. Sem dono, não abre nada.
 */
export function useLocalOutbox(): void {
  const ownerId = useSession().user?.id;

  useEffect(() => {
    if (ownerId) void openLocalStore(ownerId);
  }, [ownerId]);
}
