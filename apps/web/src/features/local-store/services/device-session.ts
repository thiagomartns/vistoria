import type { AuthDto } from "@/shared/api/generated";
import {
  type SessionUser,
  beginSession,
  currentOwner,
  signOutOnServer,
  signOutSession,
} from "@/shared/auth/session";

import { pendingOf, wipeLocalStore } from "./local-store";

// Entrar, trocar de usuário e sair, com o banco local do aparelho (frontend.md, "Sessão" e "Dados no aparelho";
// ADR 0046). Fica aqui, e não em `shared/auth`, porque junta a sessão com o banco do usuário, que é desta feature.

/** O login de outro `user.id` com pendências do dono anterior: espera a pessoa decidir. */
export interface OtherUserDecision {
  previous: SessionUser;
  /** As alterações do anterior que se perdem (`pendingOf`). */
  pending: number;
  /** Apaga o banco local do anterior e começa a sessão da conta nova. */
  confirm: () => Promise<void>;
  /** Faz o `signOut` da conta nova; o anterior e o banco dele ficam como estavam. */
  cancel: () => Promise<void>;
}

/**
 * Começa a sessão de quem acabou de entrar (ou se cadastrar) neste aparelho. O mesmo dono, ou nenhum, entra direto e
 * retoma a fila. Outro `user.id` sem pendências do anterior apaga o banco dele e entra. Com pendências, devolve a
 * decisão: o token da conta nova fica só nela e não vira sessão antes de confirmar.
 */
export async function enterOnDevice(auth: AuthDto): Promise<OtherUserDecision | null> {
  const previous = currentOwner();
  if (!previous || previous.id === auth.user.id) {
    beginSession(auth);
    return null;
  }
  const replace = async () => {
    await wipeLocalStore(previous.id);
    beginSession(auth);
  };
  const pending = await pendingOf(previous.id);
  if (pending === 0) {
    await replace();
    return null;
  }
  return { previous, pending, confirm: replace, cancel: signOutOnServer };
}

/**
 * Sai neste aparelho: esquece a sessão antes de tudo (nenhuma tela reabre o banco do dono no meio), e então o
 * `signOut` na API e a limpeza local correm juntos. O erro de rede do `signOut` nunca impede a limpeza.
 */
export async function signOutOnDevice(): Promise<void> {
  const owner = currentOwner();
  signOutSession();
  await Promise.allSettled([signOutOnServer(), owner ? wipeLocalStore(owner.id) : undefined]);
}
