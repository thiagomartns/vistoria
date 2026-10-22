import { accessToken, readFailure } from "../api/client";
import { type AuthDto, type AuthUserDto, signIn, signUp } from "../api/generated";
import { zAuthUserDto } from "../api/generated/zod.gen";
import type { ApiFailure } from "../api/problems";

// Sessão sem refresh (M4, frontend.md "Sessão"): o access token só em memória e o dono do aparelho (o `user.id` e o
// nome, que não são segredo) no localStorage. Recarregar perde o token mas não o dono, então o app abre o banco
// local certo e mostra os dados; a outbox espera um login novo do mesmo usuário.

export type SessionUser = AuthUserDto;

/**
 * - `signed-out`: ninguém entrou neste aparelho (ou saiu).
 * - `active`: o dono está com token; a outbox envia.
 * - `expired`: há dono, mas não há token (recarregou, ou a API recusou o token). A outbox espera.
 */
export type SessionStatus = "signed-out" | "active" | "expired";

export interface SessionSnapshot {
  /** `false` no prerender e na hidratação, antes de ler o localStorage: ninguém decide nada por ele ainda. */
  ready: boolean;
  status: SessionStatus;
  user: SessionUser | null;
}

const OWNER_KEY = "vistoria.owner";

const SERVER_SNAPSHOT: SessionSnapshot = { ready: false, status: "signed-out", user: null };

let snapshot: SessionSnapshot | undefined;
const listeners = new Set<() => void>();

function readOwner(): SessionUser | null {
  try {
    const parsed = zAuthUserDto.safeParse(JSON.parse(localStorage.getItem(OWNER_KEY) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeOwner(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(OWNER_KEY, JSON.stringify({ id: user.id, name: user.name }));
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Sem localStorage (navegação privada restrita): a sessão vale até recarregar.
  }
}

function snapshotOf(user: SessionUser | null): SessionSnapshot {
  const status = !user ? "signed-out" : accessToken.get() ? "active" : "expired";
  return { ready: true, status, user };
}

function current(): SessionSnapshot {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  snapshot ??= snapshotOf(readOwner());
  return snapshot;
}

function update(user: SessionUser | null) {
  snapshot = snapshotOf(user);
  for (const listener of listeners) listener();
}

/** Store para o `useSyncExternalStore`. */
export const sessionStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: current,
  getServerSnapshot: (): SessionSnapshot => SERVER_SNAPSHOT,
};

/** A outbox de `ownerId` só envia com a sessão ativa desse mesmo usuário: nunca com o token de outro. */
export function canSendAs(ownerId: string): boolean {
  const { status, user } = current();
  return status === "active" && user?.id === ownerId;
}

function start({ accessToken: token, user }: AuthDto) {
  accessToken.set(token);
  writeOwner(user);
  update(user);
}

/** Entra com e-mail e senha; devolve a falha, ou `null` com a sessão já ativa. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<ApiFailure | null> {
  const result = await signIn({ body: { email, password } });
  if (!result.data) return readFailure(result);
  start(result.data);
  return null;
}

/** Cria a conta e já entra (sem verificação de e-mail na V1); devolve a falha, ou `null` com a sessão ativa. */
export async function signUpWithPassword(
  name: string,
  email: string,
  password: string,
): Promise<ApiFailure | null> {
  const result = await signUp({ body: { name, email, password } });
  if (!result.data) return readFailure(result);
  start(result.data);
  return null;
}

/**
 * A API recusou o token (`unauthorized`): sem refresh até o M4, a sessão expira e o dono fica. A outbox para até
 * o mesmo usuário entrar de novo.
 */
export function expireSession(): void {
  accessToken.set(null);
  update(current().user);
}

/**
 * Sai da sessão neste aparelho. Sem `signOut` na API até o M4, só esquece o token e o dono; o banco local do
 * usuário e a outbox ficam (apagar com aviso também é do M4) e voltam quando ele entrar de novo.
 */
export function signOutSession(): void {
  accessToken.set(null);
  writeOwner(null);
  update(null);
}

/** Esquece o estado em memória, como um reload. Só para testes. */
export function resetSession(): void {
  accessToken.set(null);
  snapshot = undefined;
  listeners.clear();
}
