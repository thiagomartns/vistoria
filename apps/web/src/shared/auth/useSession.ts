import { useState, useSyncExternalStore } from "react";

import { handleProblem } from "../api/problems";
import { sessionStore, signInWithPassword, signOutSession } from "./session";

/** Sessão mínima (token e usuário em memória); a sessão real é do M4. */
export function useSession() {
  const user = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
  const [error, setError] = useState<string | null>(null);

  return {
    user,
    signedIn: user !== null,
    error,
    signIn: async (email: string, password: string) => {
      const failure = await signInWithPassword(email, password);
      if (!failure) {
        setError(null);
        return true;
      }
      setError(
        handleProblem(failure) === "invalid-credentials"
          ? "E-mail ou senha incorretos."
          : "Não foi possível entrar agora.",
      );
      return false;
    },
    signOut: signOutSession,
  };
}
