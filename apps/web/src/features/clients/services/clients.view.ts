import { fold } from "@/shared/search";
import type { DraftRecord } from "@/shared/sync/drafts";
import type { RecordSyncState } from "@/shared/sync/sync-view";

import { CLIENT_ENTITY, type ClientRecord } from "../models/client";

// Do banco local para o que a lista de clientes e o cabeçalho do registro mostram. Função pura: cada estado cabe
// num teste, e os componentes recebem só o resultado.

/** O estado do SyncBadge de um client. */
export type ClientSyncState = RecordSyncState | "sincronizado" | "rejeitado";

export interface ClientRow {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  sync: ClientSyncState;
}

type ClientFields = Omit<ClientRow, "sync">;

function fieldsOf(record: Record<string, unknown>, id: string): ClientFields {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    id,
    name: text(record.name) ?? "",
    document: text(record.document),
    email: text(record.email),
    phone: text(record.phone),
  };
}

/**
 * Um client como a tela mostra. O rascunho recusado vence: ele tem o que a pessoa digitou e o servidor recusou
 * (e, numa criação recusada, é o único lugar onde o registro ainda existe).
 */
export function clientRowOf(
  client: ClientRecord | undefined,
  draft: DraftRecord | undefined,
  syncState: RecordSyncState | undefined,
): ClientRow | undefined {
  if (draft) return { ...fieldsOf(draft.data, draft.id), sync: "rejeitado" };
  if (!client) return undefined;
  return { ...fieldsOf(client, client.id), sync: syncState ?? "sincronizado" };
}

/** Busca local por nome, documento (com ou sem máscara) e e-mail. */
export function matchesSearch(row: ClientRow, search: string): boolean {
  const query = fold(search.trim());
  if (query === "") return true;
  const documentQuery = query.replace(/[.\-/\s]/g, "");
  return (
    fold(row.name).includes(query) ||
    (documentQuery !== "" && fold(row.document ?? "").includes(documentQuery)) ||
    fold(row.email ?? "").includes(query)
  );
}

/** As linhas da lista: clients e rascunhos recusados de client, em ordem alfabética. */
export function clientRows(
  clients: readonly ClientRecord[],
  allDrafts: readonly DraftRecord[],
  states: ReadonlyMap<string, RecordSyncState>,
): ClientRow[] {
  const drafts = allDrafts.filter((draft) => draft.entity === CLIENT_ENTITY);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const rows = clients.map((client) =>
    clientRowOf(client, draftById.get(client.id), states.get(client.id)),
  );
  const known = new Set(clients.map((client) => client.id));
  for (const draft of drafts) {
    if (!known.has(draft.id)) rows.push(clientRowOf(undefined, draft, undefined));
  }
  return rows
    .filter((row) => row !== undefined)
    .toSorted((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}
