import { useEffect } from "react";
import { toast } from "sonner";

import { subscribeNotices } from "./notices";

/**
 * Mostra no Toaster do shell os avisos passageiros da camada de sync (ADR 0033), como o `locked` ("concluída em outro
 * aparelho"). O id do aviso vira o do toast: o mesmo aviso repetido troca o que está na tela, sem empilhar.
 */
export function useSyncNotices(): void {
  useEffect(
    () =>
      subscribeNotices((notice) => {
        toast.warning(notice.title, { id: notice.id, description: notice.description });
      }),
    [],
  );
}
