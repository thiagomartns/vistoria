import type { InspectionDto } from "@/shared/api/generated";
import type { DraftRecord } from "@/shared/sync/drafts";
import { newId } from "@/shared/sync/ids";
import { sameValue } from "@/shared/sync/merge";

import type { InspectionRecord, ItemRecord, RoomRecord } from "../models/inspection";
import { inspectionRecordOf } from "./inspections.mappers";
import { type InspectionCollision, mergeInspection } from "./inspections.merge";

// A decisão da pessoa no ConflictResolver (frontend.md, "Conflito"): o merge refeito a partir do rascunho em conflito
// e as escolhas, "meu" ou "servidor", aplicadas por cima; e, nos tipos excluído e exclusão alterada (ADR 0040), o que
// a tela mostra e a vistoria recriada. Funções puras; o envio fica em inspections.sync.ts.

/** O ConflictResolver de uma vistoria. */
export const conflictHref = (id: string) => `/inspections/conflict?id=${encodeURIComponent(id)}`;

/**
 * O tipo do conflito de um rascunho: `edit` (os dois lados mudaram, #105), `deleted` (o `PUT` achou a vistoria excluída
 * em outro aparelho) ou `removal` (o `DELETE` achou a vistoria alterada depois que a pessoa a abriu). Sem conflito,
 * `undefined`.
 */
export type ConflictKind = "edit" | "deleted" | "removal";

export function conflictKindOf(draft: DraftRecord | undefined): ConflictKind | undefined {
  if (draft?.status !== "conflict") return undefined;
  return draft.conflict?.type ?? "edit";
}

/** De que lado fica o valor de um campo em disputa. */
export type ConflictChoice = "meu" | "servidor";

export interface InspectionConflict {
  base: InspectionRecord | undefined;
  /** O rascunho como está agora, com o que a pessoa marcou depois do conflito. */
  local: InspectionRecord;
  /** O `current` do servidor na forma do registro, com a `version` dele. */
  server: InspectionRecord;
  /** O merge: o que só um lado mudou já entra; no que colidiu, segue o local. */
  merged: InspectionRecord;
  collisions: InspectionCollision[];
  /** Quando o rascunho mudou por último e quando o servidor gravou o `current` (sem a data no DTO, ausente). */
  localAt: string;
  serverAt: string | undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shaped = (record: Record<string, unknown>): InspectionRecord =>
  inspectionRecordOf(record as unknown as InspectionDto);

/**
 * O conflito de uma vistoria, refeito na hora: base = a `serverShadow` guardada, local = o rascunho (o mais novo do
 * aparelho, não o de quando o conflito chegou) e servidor = o `current`. Sem rascunho em conflito de edição ou sem
 * `current`, não há o que escolher aqui.
 */
export function inspectionConflictOf(
  draft: DraftRecord | undefined,
): InspectionConflict | undefined {
  const current = conflictKindOf(draft) === "edit" ? draft?.conflict?.current : undefined;
  if (!draft || !isObject(current)) return undefined;
  const server = shaped(current);
  const local = { ...shaped(draft.data), version: server.version };
  const base = isObject(draft.conflict?.base) ? shaped(draft.conflict.base) : undefined;
  const { merged, collisions } = mergeInspection(base, local, server);
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

/** A chave de uma colisão, estável entre um render e outro: "root:generalNotes", "room:r1:item:t1:condition". */
export function collisionKey(collision: InspectionCollision): string {
  const path = [
    collision.roomId ? `room:${collision.roomId}` : "root",
    ...(collision.itemId ? [`item:${collision.itemId}`] : []),
  ];
  return collision.kind === "field"
    ? [...path, collision.field].join(":")
    : ["removed", ...path].join(":");
}

type Positioned = { id: string; position: number };

/** A lista na ordem da `position` (no empate, a ordem em que está), renumerada de 0 a n−1. */
const renumbered = <T extends Positioned>(list: T[]): T[] =>
  list
    .toSorted((a, z) => a.position - z.position)
    .map((entry, position) => ({ ...entry, position }));

/** "Servidor" num elemento removido de um lado: fica como o servidor tem, presente ou não. */
function withServerSide<T extends Positioned>(list: T[], id: string, server: T | undefined): T[] {
  const rest = list.filter((entry) => entry.id !== id);
  return server ? [...rest, structuredClone(server)] : rest;
}

/**
 * O registro do reenvio: o merge com as escolhas aplicadas. "Meu" mantém o que o merge já tem (o local); "servidor"
 * põe o valor do servidor no campo, ou deixa o ambiente ou item como o servidor tem (removido ou presente). A ordem é
 * renumerada no fim. A `version` é a do `current`, a `baseVersion` do reenvio. Colisão sem escolha segue o local.
 */
export function resolveInspection(
  conflict: InspectionConflict,
  choices: Readonly<Record<string, ConflictChoice>>,
): InspectionRecord {
  const resolved = structuredClone(conflict.merged);
  for (const collision of conflict.collisions) {
    if (choices[collisionKey(collision)] !== "servidor") continue;
    const room = resolved.rooms.find((entry) => entry.id === collision.roomId);
    if (collision.kind === "removed" && collision.itemId === undefined) {
      resolved.rooms = withServerSide(resolved.rooms, collision.roomId, collision.server);
    } else if (collision.kind === "removed") {
      if (room) room.items = withServerSide(room.items, collision.itemId, collision.server);
    } else if (!collision.roomId) {
      Object.assign(resolved, { [collision.field]: collision.server });
    } else if (!collision.itemId) {
      if (room) Object.assign(room, { [collision.field]: collision.server } as Partial<RoomRecord>);
    } else {
      const item = room?.items.find((entry) => entry.id === collision.itemId);
      if (item) Object.assign(item, { [collision.field]: collision.server } as Partial<ItemRecord>);
    }
  }
  resolved.rooms = renumbered(resolved.rooms).map((room) => ({
    ...room,
    items: renumbered(room.items),
  }));
  return { ...resolved, version: conflict.server.version };
}

/** O que mudou neste aparelho desde a base: itens incluídos, alterados ou removidos, e em quantos ambientes. */
export interface ChangeSummary {
  items: number;
  rooms: number;
}

/**
 * Conta, por item, o que o local tem de diferente da base (a última versão que o servidor confirmou): incluído,
 * alterado ou removido. Um ambiente incluído ou removido conta com os itens dele. Sem base (criada neste aparelho),
 * tudo conta. Mudar de posição não conta: a lista se renumera quando um vizinho sai.
 */
const unplaced = (item: ItemRecord | undefined) => {
  if (!item) return undefined;
  const { position: _position, ...rest } = item;
  return rest;
};

export function changeSummary(
  base: InspectionRecord | undefined,
  local: InspectionRecord,
): ChangeSummary {
  const before = new Map(base?.rooms.map((room) => [room.id, room]));
  const roomIds = new Set([...before.keys(), ...local.rooms.map((room) => room.id)]);
  let items = 0;
  let rooms = 0;
  for (const roomId of roomIds) {
    const old = before.get(roomId)?.items ?? [];
    const now = local.rooms.find((room) => room.id === roomId)?.items ?? [];
    const oldById = new Map(old.map((item) => [item.id, item]));
    const nowById = new Map(now.map((item) => [item.id, item]));
    let changed = 0;
    for (const id of new Set([...oldById.keys(), ...nowById.keys()])) {
      if (!sameValue(unplaced(oldById.get(id)), unplaced(nowById.get(id)))) changed += 1;
    }
    items += changed;
    if (changed > 0) rooms += 1;
  }
  return { items, rooms };
}

/**
 * A vistoria recriada (frontend.md, "Conflito", passo 4): os mesmos dados com ids novos na raiz, nos ambientes e nos
 * itens, porque os da excluída continuam usados no servidor (backend.md, "Exclusão": só a raiz é excluída), e sem
 * `version`: ela nasce no próximo `PUT`, sem `If-Match`.
 */
export function recreatedInspection(record: InspectionRecord): InspectionRecord {
  const { deleting: _deleting, ...values } = structuredClone(record);
  return {
    ...values,
    id: newId(),
    version: null,
    rooms: values.rooms.map((room) => ({
      ...room,
      id: newId(),
      items: room.items.map((item) => ({ ...item, id: newId() })),
    })),
  };
}
