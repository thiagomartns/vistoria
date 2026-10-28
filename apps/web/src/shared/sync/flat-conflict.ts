import type { DraftRecord } from "./drafts";
import { type FieldCollision, mergeFields, recordShape } from "./merge";

// O conflito de um registro plano, cliente ou imóvel (frontend.md, "Conflito"; ADR 0038): o merge por campo refeito a
// partir do rascunho em conflito, as escolhas da pessoa por cima e os campos em disputa como o ConflictResolver mostra.
// Funções puras; o envio fica no `.sync.ts` da feature, pelo `resolveConflict` de upsert.ts.

type FlatRecord = { id: string; version: string | null };

/** De que lado fica o valor de um campo em disputa. */
export type ConflictChoice = "meu" | "servidor";

export interface FlatConflict<T extends FlatRecord> {
  base: T | undefined;
  /** O rascunho como está agora, com o que a pessoa salvou no formulário depois do conflito. */
  local: T;
  /** O `current` do servidor na forma do registro, com a `version` dele. */
  server: T;
  /** O merge: o que só um lado mudou já entra; no que colidiu, segue o local. */
  merged: T;
  collisions: FieldCollision<Extract<keyof T, string>>[];
  /** Quando o rascunho mudou por último e quando o servidor gravou o `current` (sem a data no DTO, ausente). */
  localAt: string;
  serverAt: string | undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * O conflito de um registro plano, refeito na hora: base = a `serverShadow` guardada, local = o rascunho e servidor =
 * o `current`. Sem rascunho em conflito ou sem `current` (`deleted`), não há o que escolher.
 */
export function flatConflictOf<T extends FlatRecord>(
  draft: DraftRecord | undefined,
): FlatConflict<T> | undefined {
  const current = draft?.status === "conflict" ? draft.conflict?.current : undefined;
  if (!draft || !isObject(current)) return undefined;
  const like = draft.data as T;
  const server = recordShape(current, like);
  const local: T = { ...like, version: server.version };
  const base = isObject(draft.conflict?.base) ? recordShape(draft.conflict.base, like) : undefined;
  const { merged, collisions } = mergeFields(base, local, server);
  return {
    base,
    local,
    server,
    merged,
    collisions,
    localAt: draft.updatedAt,
    serverAt: typeof current.updatedAt === "string" ? current.updatedAt : undefined,
  };
}

/**
 * O registro do reenvio: o merge com as escolhas. "Servidor" põe o valor do servidor no campo; "meu" (ou sem escolha)
 * mantém o local. A `version` é a do `current`, a `baseVersion` do reenvio.
 */
export function resolveFlat<T extends FlatRecord>(
  conflict: FlatConflict<T>,
  choices: Readonly<Record<string, ConflictChoice>>,
): T {
  const resolved: Record<string, unknown> = { ...conflict.merged };
  for (const collision of conflict.collisions) {
    if (choices[collision.field] === "servidor") resolved[collision.field] = collision.server;
  }
  return { ...resolved, version: conflict.server.version } as T;
}

/** Um campo em disputa como o ConflictResolver mostra; a chave é o nome do campo. */
export interface FlatConflictField {
  key: string;
  label: string;
  /** "Antes: Maria Souza"; sem a base, ausente. */
  before: string | null;
  mine: string;
  theirs: string;
}

export interface FlatConflictGroup {
  id: string;
  title: string;
  fields: FlatConflictField[];
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === "";

/**
 * Os campos em disputa num grupo só (o registro plano não tem ambiente), na ordem de `labels`, que é a do formulário.
 * `format` dá o texto de um valor preenchido; o vazio é "Sem valor", ou o de `empty` ("Sem observação").
 */
export function flatConflictGroups<T extends FlatRecord>(
  conflict: FlatConflict<T>,
  {
    title,
    labels,
    format = (_field, value) => String(value),
    empty,
  }: {
    title: string;
    labels: Readonly<Partial<Record<Extract<keyof T, string>, string>>>;
    format?: (field: Extract<keyof T, string>, value: unknown) => string;
    empty?: Readonly<Partial<Record<Extract<keyof T, string>, string>>>;
  },
): FlatConflictGroup[] {
  if (conflict.collisions.length === 0) return [];
  const order = Object.keys(labels);
  const rank = (field: string) => {
    const index = order.indexOf(field);
    return index === -1 ? order.length : index;
  };
  const textOf = (field: Extract<keyof T, string>, value: unknown) =>
    isEmpty(value) ? (empty?.[field] ?? "Sem valor") : format(field, value);
  const beforeOf = (field: Extract<keyof T, string>, value: unknown) => {
    const shown = textOf(field, value);
    return `Antes: ${isEmpty(value) ? shown.charAt(0).toLowerCase() + shown.slice(1) : shown}`;
  };
  const fields = conflict.collisions
    .toSorted((a, z) => rank(a.field) - rank(z.field))
    .map((collision) => ({
      key: collision.field,
      label: labels[collision.field] ?? collision.field,
      before: conflict.base ? beforeOf(collision.field, collision.base) : null,
      mine: textOf(collision.field, collision.local),
      theirs: textOf(collision.field, collision.server),
    }));
  return [{ id: "", title, fields }];
}
