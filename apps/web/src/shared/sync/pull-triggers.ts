import { canSendAs, renewAfterReconnect, sessionStore } from "../auth/session";
import type { DraftsCollection } from "./drafts";
import { type SyncSnapshot, syncStatusStore } from "./sync-status";

// Quando o pull roda (frontend.md, "Leitura (pull)"): ao abrir o app com sessão ativa, quando a sessão do dono volta,
// quando a rede volta, a cada intervalo com o app visível, logo depois que a outbox esvazia e quando um rascunho sai do
// aparelho (descartar um rascunho dispara um ciclo, ADR 0041). Um ciclo por vez.

/** Pull periódico com o app visível (backend.md, "Parâmetros compartilhados"). */
export const PULL_INTERVAL_MS = 60_000;

export interface PullTriggers {
  /** Pede um ciclo agora: começa se nenhum estiver rodando; senão, roda um logo depois do atual. */
  trigger: () => void;
  dispose: () => void;
}

/**
 * Liga os gatilhos do pull do dono `ownerId`. Só roda com a sessão ativa dele (`canSendAs`), como a outbox. Um gatilho
 * durante um ciclo não abre outro em paralelo: vira um ciclo só, depois do atual, para não perder o que mudou durante
 * ele (a outbox que esvaziou com a página em voo, por exemplo).
 */
export function startPull({
  ownerId,
  run,
  drafts,
}: {
  ownerId: string;
  run: () => Promise<unknown>;
  drafts: Pick<DraftsCollection, "subscribeChanges">;
}): PullTriggers {
  let disposed = false;
  let running = false;
  let again = false;

  const cycle = async () => {
    running = true;
    try {
      do {
        again = false;
        if (disposed || !canSendAs(ownerId)) break;
        try {
          await run();
        } catch (error) {
          console.warn("[pull] ciclo falhou", error);
        }
      } while (again);
    } finally {
      running = false;
    }
  };

  const trigger = () => {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    void cycle();
  };

  let previous: SyncSnapshot = syncStatusStore.getSnapshot();
  const stopStatus = syncStatusStore.subscribe(() => {
    const next = syncStatusStore.getSnapshot();
    const networkBack = next.online && !previous.online;
    const outboxDrained =
      next.outboxRead &&
      next.entries.length === 0 &&
      previous.outboxRead &&
      previous.entries.length > 0;
    previous = next;
    // Na volta da rede, a renovação sai antes: o ciclo encontra a sessão `renewing` e espera o gatilho da sessão.
    if (networkBack) renewAfterReconnect();
    if (networkBack || outboxDrained) trigger();
  });

  let couldSend = canSendAs(ownerId);
  const stopSession = sessionStore.subscribe(() => {
    const can = canSendAs(ownerId);
    if (can && !couldSend) trigger();
    couldSend = can;
  });

  // Com o estado inicial: a assinatura só avisa a exclusão de uma chave que ela já entregou. O estado inicial só traz
  // inserções, então não dispara nada.
  const draftsChanges = drafts.subscribeChanges(
    (changes) => {
      if (changes.some((change) => change.type === "delete")) trigger();
    },
    { includeInitialState: true },
  );

  const timer = setInterval(() => {
    if (globalThis.document?.visibilityState !== "hidden") trigger();
  }, PULL_INTERVAL_MS);

  trigger();

  return {
    trigger,
    dispose() {
      disposed = true;
      clearInterval(timer);
      stopStatus();
      stopSession();
      draftsChanges.unsubscribe();
    },
  };
}
