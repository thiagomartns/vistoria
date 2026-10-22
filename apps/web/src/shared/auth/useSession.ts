import { useSyncExternalStore } from "react";

import { sessionStore, signOutSession } from "./session";

/** A sessão deste aparelho (estado, dono) e o "Sair". */
export function useSession() {
  const session = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
  return { ...session, signOut: signOutSession };
}
