import { useEffect, useState } from "react";

import { clock } from "../clock";
import { offlineWindowExpired } from "./offline-window";
import { useSession } from "./useSession";

/** De quanto em quanto tempo o shell confere a janela com o app aberto. */
export const OFFLINE_WINDOW_CHECK_MS = 60 * 1000;

/**
 * A janela de uso offline venceu para o dono deste aparelho? Conferida ao montar, a cada mudança da sessão (um refresh
 * aceito grava a data nova e libera na hora) e a cada minuto com o app aberto. Sem dono, nunca: o shell manda para o /login.
 */
export function useOfflineWindow(): { expired: boolean } {
  const { ready, user, renewedAt } = useSession();
  const [now, setNow] = useState(() => clock.now());

  // Um refresh aceito grava `renewedAt` depois do `now` guardado: a diferença fica negativa e libera na hora, sem
  // esperar o próximo minuto.
  useEffect(() => {
    const timer = setInterval(() => setNow(clock.now()), OFFLINE_WINDOW_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  return { expired: ready && user !== null && offlineWindowExpired(renewedAt, now) };
}
