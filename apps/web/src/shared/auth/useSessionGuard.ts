import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { type SessionSnapshot } from "./session";
import { afterSignIn } from "./useAuthForm";
import { useSession } from "./useSession";

/**
 * Para onde o shell manda, ou `null` para ficar. Sem dono, `/login`. Sessão expirada fica enquanto não há rede (os
 * dados locais aparecem e a outbox espera); com rede, `/login` pede para entrar de novo (SessionExpired).
 */
export function shellRedirect(session: SessionSnapshot, online: boolean): string | null {
  if (!session.ready) return null;
  if (session.status === "signed-out") return "/login";
  if (session.status === "expired" && online) return "/login";
  return null;
}

/** Guarda do shell: aplica `shellRedirect` quando a sessão ou a rede mudam. */
export function useSessionGuard(offline: boolean): void {
  const { ready, status, user } = useSession();
  const router = useRouter();

  useEffect(() => {
    const target = shellRedirect({ ready, status, user }, !offline);
    if (!target) return;
    // Depois do login, volta para a tela onde estava.
    const here = window.location.pathname + window.location.search;
    router.replace(`${target}?next=${encodeURIComponent(here)}`);
  }, [ready, status, user, offline, router]);
}

/** /login e /signup: quem já está com a sessão ativa vai direto para o app. */
export function useLeaveWhenActive(): void {
  const { ready, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && status === "active") router.replace(afterSignIn(window.location.search));
  }, [ready, status, router]);
}
