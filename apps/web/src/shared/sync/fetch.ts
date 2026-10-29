import { expireSession } from "../auth/session";
import { readFailure } from "../api/client";
import { handleProblem } from "../api/problems";
import type { DraftsCollection } from "./drafts";
import { type LocalCollection, type SyncRecord, adoptServer, dropConfirmed } from "./upsert";

// A leitura por id (frontend.md, "Leitura (pull)"; ADR 0038): abrir um registro que não está no banco local busca o
// `GET` dele e grava a resposta na store confirmada, com a `version`, como depois de um envio aceito. Ela vira a
// `serverShadow` do próximo merge. Com o delta (M4), fica para o link aberto antes do primeiro pull e para a marca de
// um registro que o pull pulou por ter pendência (ADR 0041).

/**
 * - `local`: o registro já está no aparelho (confirmado, na fila ou num rascunho; no `refetchById`, só com
 *   pendência); nada foi pedido, ou a resposta foi descartada.
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
 * O registro tem pendência (ADR 0041): uma transação na fila, inclusive a que está em voo e a exclusão (`deleting`), ou
 * um rascunho de qualquer status. A fila se lê da camada otimista (`$hasPendingWrites`), que vale na hora: uma escrita
 * de agora já conta, antes de a outbox a gravar.
 */
export const hasPending = (
  store: { get: (id: string) => unknown },
  drafts: DraftsCollection,
  id: string,
): boolean =>
  (store.get(id) as { $hasPendingWrites?: boolean } | undefined)?.$hasPendingWrites === true ||
  drafts.has(id);

type FetchArgs<T extends SyncRecord, D> = {
  store: LocalCollection<T>;
  drafts: DraftsCollection;
  id: string;
  get: GetCall<D>;
  /** O DTO do servidor na forma do registro local, com a `version`. */
  shape: (dto: D) => T;
};

/**
 * Busca o registro `id` no servidor se ele não está no aparelho e grava na store confirmada. `before` roda antes da
 * gravação, com o registro já lido: é onde a vistoria busca o imóvel e o imóvel, o cliente, para a tela nunca abrir o
 * filho sem o pai. Uma escrita feita no aparelho durante o `GET` vence, e a resposta é descartada. A reação à falha
 * vem do grupo do `type` (frontend.md, "Reação aos erros"), nunca do status.
 */
export function fetchMissing<T extends SyncRecord, D>({
  before,
  ...args
}: FetchArgs<T, D> & { before?: (record: T) => Promise<unknown> }): Promise<FetchOutcome> {
  return fetchInto(args, isLocal, before);
}

/**
 * Busca de novo o registro `id`, que o aparelho pode já ter: a marca de um registro que o pull pulou (ADR 0041). Ao
 * contrário do `fetchMissing`, estar no aparelho não basta para não buscar; só a pendência (`hasPending`) segura o
 * `GET`, e uma pendência que volta durante ele descarta a resposta (`local`).
 */
export function refetchById<T extends SyncRecord, D>(args: FetchArgs<T, D>): Promise<FetchOutcome> {
  return fetchInto(args, hasPending);
}

async function fetchInto<T extends SyncRecord, D>(
  { store, drafts, id, get, shape }: FetchArgs<T, D>,
  keep: (store: LocalCollection<T>, drafts: DraftsCollection, id: string) => boolean,
  before?: (record: T) => Promise<unknown>,
): Promise<FetchOutcome> {
  if (keep(store, drafts, id)) return "local";
  if (globalThis.navigator?.onLine === false) return "offline";
  const result = await get({ path: { id } });
  if (result.data !== undefined) {
    const record = shape(result.data);
    await before?.(record);
    if (keep(store, drafts, id)) return "local";
    await adoptServer(store, record);
    return "found";
  }
  const failure = readFailure({ error: result.error, response: result.response });
  if (failure.kind === "network") return "offline";
  switch (handleProblem(failure)) {
    case "remove-local":
      if (keep(store, drafts, id)) return "local";
      await dropConfirmed(store, id);
      return "not-found";
    case "renew-session":
      expireSession();
      return "failed";
    default:
      return "failed";
  }
}
