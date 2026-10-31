// Janela de uso offline (backend.md, "Parâmetros compartilhados"): 72 h desde a última renovação aceita (refresh ou
// login). Passado o prazo, a UI trava em "Reconecte para continuar", sem apagar nada (frontend.md, "Sessão").

export const OFFLINE_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * A janela venceu? Sem a data da última renovação (aparelho de antes do #132, ou localStorage apagado), não há de onde
 * contar: vale como vencida até um refresh aceito, que grava a data e libera (ADR 0046).
 */
export function offlineWindowExpired(renewedAt: Date | null, now: Date): boolean {
  if (!renewedAt) return true;
  return now.getTime() - renewedAt.getTime() > OFFLINE_WINDOW_MS;
}
