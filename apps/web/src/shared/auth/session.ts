import { accessToken, readFailure } from "../api/client";
import { type AuthUserDto, signIn } from "../api/generated";
import type { ApiFailure } from "../api/problems";

// Sessão mínima: o access token e quem entrou, só em memória. Refresh, janela offline e várias abas são do M4
// (frontend.md, "Sessão"); recarregar a página sai da sessão.

export type SessionUser = AuthUserDto;

let user: SessionUser | null = null;
const listeners = new Set<() => void>();

function setUser(next: SessionUser | null) {
  user = next;
  for (const listener of listeners) listener();
}

/** Store para o `useSyncExternalStore`: quem está na sessão, ou `null`. */
export const sessionStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): SessionUser | null => user,
  getServerSnapshot: (): SessionUser | null => null,
};

/** Entra com e-mail e senha; devolve a falha, ou `null` com o token e o usuário já em memória. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<ApiFailure | null> {
  const result = await signIn({ body: { email, password } });
  if (!result.data) return readFailure(result);
  accessToken.set(result.data.accessToken);
  setUser(result.data.user);
  return null;
}

/**
 * Sai da sessão neste aparelho. Sem `signOut` na API até o M4 (o refresh em cookie chega junto), então só
 * esquece o token e o usuário; os dados locais e a outbox ficam (apagar com aviso também é do M4).
 */
export function signOutSession(): void {
  accessToken.set(null);
  setUser(null);
}
