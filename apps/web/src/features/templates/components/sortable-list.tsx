import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

import { SortableItem } from "@/shared/components/sortable-item";

// A lista que se reordena arrastando pela alça (ADR 0057), para ambientes e itens do roteiro: o dnd-kit com o ponteiro
// (mouse e toque, a partir de 4 px, para o toque na alça não virar arrasto sem querer) e o teclado (Espaço pega, setas
// movem, Espaço solta, Esc cancela), com os anúncios do leitor de tela em português. A ordem nova sai por `onMove`.

const INSTRUCTIONS =
  "Para mover, pressione Espaço. Use as setas para cima e para baixo para mudar a posição, Espaço de novo para soltar e Esc para cancelar.";

type SortableListProps = {
  /** Os ids, na ordem da lista. */
  ids: string[];
  /** O nome de cada linha, na mesma ordem, para os anúncios. */
  names: string[];
  onMove: (from: number, to: number) => void;
  /** O nome acessível da lista ("Ambientes"). */
  label: string;
  children: ReactNode;
};

export function SortableList({ ids, names, onMove, label, children }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const indexOf = (id: UniqueIdentifier) => ids.indexOf(String(id));
  const nameOf = (id: UniqueIdentifier) => names[indexOf(id)] ?? "";
  const at = (id: UniqueIdentifier | undefined) =>
    id === undefined ? "" : `posição ${indexOf(id) + 1} de ${ids.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} levantado, na ${at(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} na ${at(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} solto na ${at(over.id)}.` : `${nameOf(active.id)} solto.`,
    onDragCancel: ({ active }) => `Cancelado. ${nameOf(active.id)} voltou à ${at(active.id)}.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onMove(indexOf(active.id), indexOf(over.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className="flex flex-col gap-2">
          {children}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

type SortableRowProps = {
  id: string;
  /** "Mover Sala". */
  handleLabel: string;
  selected?: boolean;
  children: ReactNode;
};

/** Uma linha da `SortableList`: o `SortableItem` com a alça ligada ao dnd-kit. */
export function SortableRow({ id, handleLabel, selected, children }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, attributes: { roleDescription: "item reordenável" } });
  return (
    <SortableItem
      itemRef={setNodeRef}
      handleRef={setActivatorNodeRef}
      handleProps={{ ...attributes, ...listeners }}
      handleLabel={handleLabel}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      selected={selected}
      dragging={isDragging}
    >
      {children}
    </SortableItem>
  );
}
