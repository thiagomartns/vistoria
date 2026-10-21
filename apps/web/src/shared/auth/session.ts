import { accessToken, readFailure } from "../api/client";
import { signIn } from "../api/generated";
import type { ApiFailure } from "../api/problems";

// Sessão mínima do spike 1a: entra e guarda o access token em memória. Refresh, janela offline e
// várias abas são do M4 (frontend.md, "Sessão").

/** Entra com e-mail e senha; devolve a falha, ou `null` com o token já em memória. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<ApiFailure | null> {
  const result = await signIn({ body: { email, password } });
  if (!result.data) return readFailure(result);
  accessToken.set(result.data.accessToken);
  return null;
}
