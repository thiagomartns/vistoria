import { useEffect } from "react";

import { openClientsStore } from "../services/clients.sync";

/**
 * Abre a outbox de clients em qualquer página do app, para as transações pendentes voltarem à fila e
 * aparecerem no SyncStatus. Fica no shell até a outbox única de clients e properties (#74).
 */
export function useClientsOutbox(): void {
  useEffect(() => {
    void openClientsStore();
  }, []);
}
