import { newId } from "@/shared/sync/ids";

import { ROOM_CATALOG, type RoomMold } from "../models/room-catalog";
import type { RoomFormValues } from "../schemas/template.schemas";
import { itemsLabel } from "./templates.view";

// Os ambientes prontos do editor de roteiro (#200): a linha de cada um no Sheet "Adicionar ambientes" e a montagem dos
// escolhidos como ambientes do formulário, com ids novos e o nome numerado quando o mesmo entra mais de uma vez.

/** Quantos de um ambiente pronto foram escolhidos. */
export interface RoomChoice {
  name: string;
  count: number;
}

/** Um ambiente pronto no Sheet: o nome e "7 itens · Piso, Paredes, Teto e mais 4". */
export interface CatalogRoomView {
  name: string;
  detail: string;
}

const SHOWN = 3;

function itemsPreview(names: readonly string[]): string {
  if (names.length <= SHOWN) {
    return names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
  }
  return `${names.slice(0, SHOWN).join(", ")} e mais ${names.length - SHOWN}`;
}

/** A linha de um ambiente pronto: o nome, quantos itens e os primeiros deles. */
export function catalogRoomView(room: RoomMold): CatalogRoomView {
  const names = room.items.map((item) => item.name);
  return {
    name: room.name,
    detail: [itemsLabel(names.length), itemsPreview(names)].filter(Boolean).join(" · "),
  };
}

/** Os ambientes prontos, na ordem do catálogo. */
export const catalogRoomViews = (): CatalogRoomView[] => ROOM_CATALOG.map(catalogRoomView);

const normalized = (name: string) => name.trim().toLocaleLowerCase("pt-BR");

/**
 * O maior número já usado por `base` no roteiro: "Quarto" conta como 1, "Quarto 3" como 3; 0 se nenhum ambiente usa
 * esse nome.
 */
function usedNumber(base: string, existing: readonly string[]): number {
  const wanted = normalized(base);
  let max = 0;
  for (const name of existing) {
    const current = normalized(name);
    if (current === wanted) max = Math.max(max, 1);
    else if (current.startsWith(`${wanted} `)) {
      const suffix = current.slice(wanted.length + 1);
      if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
    }
  }
  return max;
}

/**
 * Os ambientes escolhidos como ambientes do formulário, na ordem do catálogo, com os itens do catálogo e ids v7 novos
 * no ambiente e em cada item. O mesmo ambiente escolhido mais de uma vez é numerado ("Quarto 1", "Quarto 2"); se o
 * roteiro já tem "Quarto" ou "Quarto N", os novos continuam a contagem, sem renomear os que já estão lá. Para em
 * `left`, o que ainda cabe no roteiro.
 */
export function roomsFromCatalog(
  choices: readonly RoomChoice[],
  existing: readonly string[],
  left: number = Number.POSITIVE_INFINITY,
): RoomFormValues[] {
  const counts = new Map(choices.map((choice) => [choice.name, choice.count]));
  const rooms: RoomFormValues[] = [];
  for (const mold of ROOM_CATALOG) {
    const count = Math.max(0, Math.floor(counts.get(mold.name) ?? 0));
    if (count === 0) continue;
    const used = usedNumber(mold.name, existing);
    const numbered = used > 0 || count > 1;
    for (let index = 0; index < count && rooms.length < left; index += 1) {
      rooms.push({
        roomId: newId(),
        name: numbered ? `${mold.name} ${used + index + 1}` : mold.name,
        items: mold.items.map((item) => ({ itemId: newId(), name: item.name })),
      });
    }
  }
  return rooms;
}
