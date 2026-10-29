import { expireSession } from "../auth/session";
import { readFailure } from "../api/client";
import { handleProblem } from "../api/problems";
import type { DraftsCollection } from "./drafts";
import { type LocalCollection, type SyncRecord, adoptServer, dropConfirmed } from "./upsert";

// A leitura por id (frontend.md, "Leitura (pull)"; ADR 0038): abrir um registro que não está no banco local busca o
// `GET` dele e grava a resposta na store confirmada, com a `version`, como depois de um envio aceito. Ela vira a
// `serverShadow` do próximo merge. Com o delta (M4), fica só para o link aberto antes do primeiro pull.

/**
 * - `local`: o registro já está no aparelho (confirmado, na fila ou num rascunho); nada foi pedido.
 * - `found`: o servidor o tinha, e ele foi gravado.
 * - `not-found`: o servidor não o tem (404 `not-found`).
 * - `offline`: sem rede; é preciso abrir uma vez com rede.
 * - `failed`: o servidor não respondeu o registro (erro dele, ou a sessão expirou); dá para tentar de novo.
 */
export type FetchOutcome = "local" | "found" | "not-found" | "offline" | "failed";

/** A chamada gerada do `GET /api/v1/<entidade>/{id}`. */
export type GetCall<D> = (request: {
  path: { id: string };
}) => Promise<{ data?: D; error?: unknown; response?: Response }>;

/** Registro com pendência nunca é sobrescrito: a camada otimista (a fila) e o rascunho vencem o `GET`. */
const isLocal = (store: { has: (id: string) => boolean }, drafts: DraftsCollection, id: string) =>
  store.has(id) || drafts.has(id);

/**
 * Busca o registro `id` no servidor se ele não está no aparelho e grava na store confirmada. `before` roda antes da
 * gravação, com o registro já lido: é onde a vistoria busca o imóvel e o imóvel, o cliente, para a tela nunca abrir o
 * filho sem o pai. Uma escrita feita no aparelho durante o `GET` vence, e a resposta é descartada. A reação à falha
 * vem do grupo do `type` (frontend.md, "Reação aos erros"), nunca do status.
 */
export async function fetchMissing<T extends SyncRecord, D>({
  store,
  drafts,
  id,
  get,
  shape,
  before,
}: {
  store: LocalCollection<T>;
  drafts: DraftsCollection;
  id: string;
  get: GetCall<D>;
  /** O DTO do servidor na forma do registro local, com a `version`. */
  shape: (dto: D) => T;
  before?: (record: T) => Promise<unknown>;
}): Promise<FetchOutcome> {
  if (isLocal(store, drafts, id)) return "local";
  if (globalThis.navigator?.onLine === false) return "offline";
  const result = await get({ path: { id } });
  if (result.data !== undefined) {
    const record = shape(result.data);
    await before?.(record);
    if (isLocal(store, drafts, id)) return "local";
    await adoptServer(store, record);
    return "found";
  }
  const failure = readFailure({ error: result.error, response: result.response });
  if (failure.kind === "network") return "offline";
  switch (handleProblem(failure)) {
    case "remove-local":
      await dropConfirmed(store, id);
      return "not-found";
    case "renew-session":
      expireSession();
      return "failed";
    default:
      return "failed";
  }
}
