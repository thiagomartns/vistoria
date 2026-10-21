import { v7 } from "uuid";

/** UUID v7 gerado no cliente: id de registro e `Idempotency-Key` (backend.md, "Idempotência"). */
export function newId(): string {
  return v7();
}
