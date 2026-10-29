import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { FetchOutcome } from "./fetch";
import { syncStatusStore } from "./sync-status";

/** O que a tela mostra no lugar do registro que não está no aparelho. */
export type FetchState = "fetching" | "offline" | "not-found" | "failed";

/** Os textos de cada entidade para os estados sem o registro. */
export interface UnavailableMessages {
  offline: string;
  notFound: string;
  failed: string;
}

/** O aviso da tela sem o registro (`RecordUnavailable`), com "Tentar de novo" só na falha do servidor. */
export interface Unavailable {
  description: string;
  onRetry?: () => void;
}

/**
 * A leitura por id na tela (frontend.md, "Leitura (pull)"): com `id`, o registro não está no banco local, e `fetch`
 * (o `fetchClient`, `fetchProperty` ou `fetchInspection` da feature) o busca. Sem rede, busca de novo quando a rede
 * volta; numa falha do servidor, o "Tentar de novo" do aviso busca de novo. Gravado o registro, o banco local o
 * entrega e a tela deixa de passar `id`; até lá, o estado segue `fetching`.
 */
export function useFetchMissing(
  id: string | null,
  fetch: ((id: string) => Promise<FetchOutcome>) | undefined,
  messages: UnavailableMessages,
) {
  const { online } = useSyncExternalStore(
    syncStatusStore.subscribe,
    syncStatusStore.getSnapshot,
    syncStatusStore.getServerSnapshot,
  );
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; outcome: FetchOutcome } | null>(null);
  // A busca de cada tentativa: um id, a tentativa e a rede de agora. A resposta de uma chave antiga é ignorada.
  const key = id === null || !fetch ? null : `${id}:${attempt}:${online}`;

  const latest = useRef(fetch);
  useEffect(() => {
    latest.current = fetch;
  });

  useEffect(() => {
    if (key === null || id === null) return;
    let active = true;
    const settle = (outcome: FetchOutcome) => {
      if (active) setResult({ key, outcome });
    };
    void latest.current?.(id).then(settle, () => settle("failed"));
    return () => {
      active = false;
    };
  }, [key, id]);

  const outcome = key !== null && result?.key === key ? result.outcome : undefined;
  const state: FetchState | null =
    key === null
      ? null
      : outcome === "offline" || outcome === "not-found" || outcome === "failed"
        ? outcome
        : "fetching";
  const retry = () => setAttempt((n) => n + 1);
  const unavailable: Unavailable | null =
    state === "offline"
      ? { description: messages.offline }
      : state === "not-found"
        ? { description: messages.notFound }
        : state === "failed"
          ? { description: messages.failed, onRetry: retry }
          : null;
  return { state, unavailable };
}
