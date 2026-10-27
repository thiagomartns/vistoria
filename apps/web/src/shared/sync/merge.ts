// Os passos 1 e 2 do conflito (frontend.md, "Conflito"): reconhecer a própria escrita cuja resposta se perdeu e o
// merge de três vias por campo. Funções puras, para cada caso caber num teste; a outbox (#104) e o ConflictResolver
// (#105) só usam o resultado. O agregado da vistoria decide por ambiente e item em cima delas (#103).

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAbsent = (value: unknown): value is null | undefined =>
  value === null || value === undefined;

/** Data e hora ISO 8601 com fuso: o aparelho grava `…00.000Z`, o .NET devolve `…00+00:00` com até 7 casas. */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function sameInstant(a: string, b: string): boolean {
  if (!ISO_DATE_TIME.test(a) || !ISO_DATE_TIME.test(b)) return false;
  const [left, right] = [Date.parse(a), Date.parse(b)];
  return !Number.isNaN(left) && left === right;
}

/**
 * Igualdade de valor entre o registro local e o DTO do servidor: `null` e ausente são iguais, datas ISO com fuso
 * comparam pelo instante, arrays pelo índice e objetos pela união das chaves.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (isAbsent(a) || isAbsent(b)) return isAbsent(a) && isAbsent(b);
  if (typeof a === "string" && typeof b === "string") return a === b || sameInstant(a, b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameValue(value, b[index]))
    );
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => sameValue(a[key], b[key]));
  }
  return a === b;
}

/** `current` tem o que foi enviado: só as chaves de `sent` contam, em qualquer nível. */
function covers(current: unknown, sent: unknown): boolean {
  if (Array.isArray(sent)) {
    return (
      Array.isArray(current) &&
      current.length === sent.length &&
      sent.every((value, index) => covers(current[index], value))
    );
  }
  if (isObject(sent)) {
    return isObject(current) && Object.keys(sent).every((key) => covers(current[key], sent[key]));
  }
  return sameValue(current, sent);
}

/**
 * O `current` do conflito é a própria escrita cuja resposta se perdeu (a chave venceu e o servidor reexecutou,
 * backend.md, "Idempotência"). Compara só o que o aparelho envia: `id` e `version` saem, e o que só existe no DTO
 * (`createdAt`, `updatedAt`, `completedAt`, os campos de referência) não conta. Sem `current` (`deleted`), não é.
 */
export function isOwnWrite(current: unknown, sent: Fields): boolean {
  if (!isObject(current)) return false;
  const { id: _id, version: _version, ...body } = sent;
  return covers(current, body);
}

/**
 * O DTO do servidor na forma do registro local: as chaves de `like` (o registro) e a `version`. Campo que o DTO não
 * traz vira `null`, como no registro. Basta para cliente e imóvel; a vistoria tem `inspectionRecordOf`.
 */
export function recordShape<T extends { id: string; version: string | null }>(
  current: Fields,
  like: T,
): T {
  const shaped: Fields = {};
  for (const key of Object.keys(like)) shaped[key] = current[key] ?? null;
  return shaped as T;
}

/** Um campo que os dois lados mudaram para valores diferentes: vai para o ConflictResolver. */
export interface FieldCollision<K extends string = string> {
  field: K;
  base: unknown;
  local: unknown;
  server: unknown;
}

export interface MergeResult<T> {
  /** O registro do reenvio: o que só um lado mudou já aplicado; no campo que colidiu, o valor local. */
  merged: T;
  collisions: FieldCollision<Extract<keyof T, string>>[];
}

/**
 * Merge de três vias por campo de um registro plano. Base = `serverShadow` (sem ela, toda diferença colide), local =
 * rascunho e servidor = `current` na forma do registro. Campo que só um lado mudou entra sozinho; os dois iguais não
 * colidem. Na colisão, `merged` guarda o valor local até a pessoa escolher, para nada marcado em campo sumir. Valor
 * composto (como `rooms`) é um campo só. `merged.version` é a do servidor, a `baseVersion` do reenvio.
 */
export function mergeFields<T extends { id: string; version: string | null }>(
  base: T | undefined,
  local: T,
  server: T,
): MergeResult<T> {
  const merged: Fields = { ...local, version: server.version };
  const collisions: FieldCollision<Extract<keyof T, string>>[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  keys.delete("id");
  keys.delete("version");
  for (const key of keys as Set<Extract<keyof T, string>>) {
    const [mine, theirs, original] = [local[key], server[key], base?.[key]];
    if (sameValue(mine, theirs)) continue;
    if (base && sameValue(mine, original)) {
      merged[key] = theirs;
    } else if (!base || !sameValue(theirs, original)) {
      collisions.push({ field: key, base: original, local: mine, server: theirs });
    }
  }
  return { merged: merged as T, collisions };
}
