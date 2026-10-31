import { useState } from "react";

import { useSession } from "@/shared/auth/useSession";
import { reloadAt } from "@/shared/navigation";

import { signOutOnDevice } from "../services/device-session";
import { pendingOf } from "../services/local-store";

/**
 * O "Sair" do menu do usuário (frames 3 a 5 da #128). Sem pendências, sai e limpa direto; com pendências, abre o
 * Dialog e só limpa depois de confirmar. Termina no /login com a página recarregada.
 */
export function useSignOut() {
  const ownerId = useSession().user?.id;
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const leave = async () => {
    setBusy(true);
    await signOutOnDevice();
    reloadAt("/login");
  };

  return {
    /** As pendências que se perdem, com o Dialog aberto; `null` com ele fechado. */
    pending,
    busy,
    request: async () => {
      if (!ownerId || busy) return;
      const count = await pendingOf(ownerId);
      if (count === 0) await leave();
      else setPending(count);
    },
    confirm: () => void leave(),
    cancel: () => setPending(null),
  };
}
