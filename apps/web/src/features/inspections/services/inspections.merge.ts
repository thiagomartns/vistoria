import { type FieldCollision, mergeFields, sameValue } from "@/shared/sync/merge";

import type { InspectionRecord, ItemRecord, RoomRecord } from "../models/inspection";

// O passo 2 do conflito (frontend.md, "Conflito") no agregado da vistoria: a raiz por campo, e ambientes e itens
// casados por `id`, cada um por campo, em cima do `mergeFields` (#102). Função pura; a outbox (#104) decide o reenvio
// e o ConflictResolver (#105) mostra só as colisões, pelo caminho (ambiente, item, campo).

/**
 * Uma colisão no agregado. `field`: os dois lados mudaram o mesmo campo; sem `roomId` é da raiz, sem `itemId` é do
 * ambiente. `removed`: um lado removeu o ambiente ou o item e o outro editou (sem base, só um lado tem); o lado que
 * removeu fica `undefined`.
 */
export type InspectionCollision =
  | ({ kind: "field"; roomId?: string; itemId?: string } & FieldCollision)
  | {
      kind: "removed";
      roomId: string;
      itemId?: undefined;
      base?: RoomRecord;
      local?: RoomRecord;
      server?: RoomRecord;
    }
  | {
      kind: "removed";
      roomId: string;
      itemId: string;
      base?: ItemRecord;
      local?: ItemRecord;
      server?: ItemRecord;
    };

export interface InspectionMerge {
  /** O registro do reenvio, com a `version` do servidor; no que colidiu, segue o local. */
  merged: InspectionRecord;
  collisions: InspectionCollision[];
}

type Positioned = { id: string; position: number; items?: Positioned[] };

/** Mudar de posição porque um vizinho saiu ou entrou não é editar: a ordem fica fora da comparação. */
function withoutPosition(entry: Positioned): Record<string, unknown> {
  const { position: _position, ...rest } = entry;
  return rest.items ? { ...rest, items: rest.items.map(withoutPosition) } : rest;
}

/** A ordem nunca colide: o merge já guardou o valor local, e a lista é renumerada no fim. */
function located(
  collisions: FieldCollision[],
  path: { roomId?: string; itemId?: string },
): InspectionCollision[] {
  return collisions
    .filter((collision) => collision.field !== "position")
    .map((collision) => ({ kind: "field", ...path, ...collision }));
}

interface ListMerge<T> {
  /** Os três lados têm o elemento; sem base, `base` é `undefined` e toda diferença colide. */
  both: (base: T | undefined, local: T, server: T) => T;
  /** Removido de um lado e editado do outro, ou, sem base, presente de um lado só. */
  removed: (id: string, sides: { base?: T; local?: T; server?: T }) => void;
}

/**
 * Ambientes ou itens casados por `id`. Incluído de um lado entra; removido de um lado e intocado do outro sai; removido
 * de um lado e editado do outro colide e segue o local. Depois, a ordem pela `position` mesclada (no empate, a do
 * servidor e então os incluídos no aparelho), renumerada de 0 a n−1.
 */
function mergeList<T extends Positioned>(
  base: T[] | undefined,
  local: T[],
  server: T[],
  on: ListMerge<T>,
): T[] {
  const byId = (list: T[]) => new Map(list.map((entry) => [entry.id, entry]));
  const [original, mine, theirs] = [base && byId(base), byId(local), byId(server)];
  const merged: T[] = [];
  for (const id of new Set([...theirs.keys(), ...mine.keys()])) {
    const [b, l, s] = [original?.get(id), mine.get(id), theirs.get(id)];
    if (l && s) {
      merged.push(on.both(b, l, s));
      continue;
    }
    const present = l ?? s;
    if (!present) continue;
    if (original && !b) {
      merged.push(present);
    } else if (!b || !sameValue(withoutPosition(b), withoutPosition(present))) {
      on.removed(id, { base: b, local: l, server: s });
      if (l) merged.push(l);
    }
  }
  return merged
    .sort((a, z) => a.position - z.position)
    .map((entry, position) => ({ ...entry, position }));
}

function mergeRoom(
  base: RoomRecord | undefined,
  local: RoomRecord,
  server: RoomRecord,
  collisions: InspectionCollision[],
): RoomRecord {
  const roomId = local.id;
  const withoutItems = (entry: RoomRecord) => {
    const { items: _items, ...room } = entry;
    return room;
  };
  const room = mergeFields(base && withoutItems(base), withoutItems(local), withoutItems(server));
  collisions.push(...located(room.collisions, { roomId }));
  const items = mergeList(base?.items, local.items, server.items, {
    both: (b, l, s) => {
      const item = mergeFields(b, l, s);
      collisions.push(...located(item.collisions, { roomId, itemId: l.id }));
      return item.merged;
    },
    removed: (itemId, sides) => collisions.push({ kind: "removed", roomId, itemId, ...sides }),
  });
  return { ...room.merged, items };
}

/**
 * Merge de três vias da vistoria. Base = `serverShadow`, local = rascunho e servidor = `current` na forma do registro
 * (`inspectionRecordOf`). Ambiente removido de um lado com qualquer mudança do outro, inclusive num item, é uma colisão
 * só, no ambiente.
 */
export function mergeInspection(
  base: InspectionRecord | undefined,
  local: InspectionRecord,
  server: InspectionRecord,
): InspectionMerge {
  const withoutRooms = (entry: InspectionRecord) => {
    const { rooms: _rooms, ...root } = entry;
    return root;
  };
  const root = mergeFields(base && withoutRooms(base), withoutRooms(local), withoutRooms(server));
  const collisions = located(root.collisions, {});
  const rooms = mergeList(base?.rooms, local.rooms, server.rooms, {
    both: (b, l, s) => mergeRoom(b, l, s, collisions),
    removed: (roomId, sides) => collisions.push({ kind: "removed", roomId, ...sides }),
  });
  return { merged: { ...root.merged, rooms }, collisions };
}
