import { useState } from "react";

import { handleProblem } from "../api/problems";
import { signInWithPassword } from "./session";

/** Estado da sessão mínima do spike 1a; a sessão real é do M4. */
export function useSession() {
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    signedIn,
    error,
    signIn: async (email: string, password: string) => {
      const failure = await signInWithPassword(email, password);
      if (!failure) {
        setSignedIn(true);
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
  };
}
