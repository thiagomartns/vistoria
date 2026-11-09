// Avisos passageiros que saem da camada de sync (frontend.md, "Reação aos erros": "Aceitar o servidor" e afins). Sem
// React: a outbox chama `notify`, e o shell assina e mostra cada aviso no Toaster do Sanjou (ADR 0033). Quem assina
// depois de um aviso não o recebe: o aviso é do momento, e o estado que ele explica já está no banco local.

export interface SyncNotice {
  /** Um aviso por id: várias transações do mesmo registro com a mesma reação não empilham toasts. */
  id: string;
  /** "warning": algo do aparelho foi descartado em favor do servidor. */
  tone: "warning";
  title: string;
  description?: string;
}

const listeners = new Set<(notice: SyncNotice) => void>();

/** Avisa quem estiver assinando (o shell). */
export function notify(notice: SyncNotice): void {
  for (const listener of listeners) listener(notice);
}

/** Assina os avisos; devolve o cancelamento. */
export function subscribeNotices(listener: (notice: SyncNotice) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
