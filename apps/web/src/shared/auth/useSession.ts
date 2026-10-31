import { useSyncExternalStore } from "react";

import { renewSession, sessionStore } from "./session";

/** A sessão deste aparelho (estado, dono, última renovação) e o "Tentar novamente" da renovação. */
export function useSession() {
  const session = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
  return { ...session, renew: renewSession };
}
