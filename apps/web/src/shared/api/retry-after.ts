// O `Retry-After` do contrato (backend.md, "Cabeçalhos"): segundos, no 429 e no 409 `idempotency-in-progress`. A outbox
// espera por ele antes de reenviar; a sessão, antes de pedir outro refresh (ADR 0062).

/** O teto do `Retry-After` respeitado: o mesmo do backoff do executor da outbox. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** O `Retry-After` em segundos, em ms; ausente ou ilegível → `undefined`. */
export function readRetryAfter(response?: Response): number | undefined {
  const value = response?.headers.get("Retry-After")?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
}
