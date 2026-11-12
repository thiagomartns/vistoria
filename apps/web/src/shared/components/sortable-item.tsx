import { Button } from "@sanjou/ui/button";
import { GripVertical } from "lucide-react";
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";

// Linha de lista que se reordena arrastando pela alça (Figma SortableItem 64:1818): a alça GripVertical à esquerda e o
// conteúdo, que é texto (nome, detalhe e seta, `tipo=texto`) ou um campo com a lixeira (`tipo=campo`). `selected` é o
// `estado=selecionado`: o ambiente aberto e o item levantado, que ganha sombra. Quem arrasta (o dnd-kit, no editor de
// roteiro) entra pelas props: a ref e o `style` da linha, e a ref, os atributos e os listeners da alça. A alça é o
// único ponto de arrasto, com `touch-none`, para a rolagem do celular seguir livre fora dela; no celular, 40 px de
// alvo. Candidato ao Sanjou.

type SortableItemProps = {
  /** O nome acessível da alça ("Mover Sala"). */
  handleLabel: string;
  handleRef?: Ref<HTMLButtonElement>;
  /** Os atributos e os listeners do arrasto, espalhados na alça. */
  handleProps?: HTMLAttributes<HTMLButtonElement>;
  itemRef?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  selected?: boolean;
  /** Levantado: `selected` com sombra, por cima das outras linhas. */
  dragging?: boolean;
  children: ReactNode;
};

export function SortableItem({
  handleLabel,
  handleRef,
  handleProps,
  itemRef,
  style,
  selected = false,
  dragging = false,
  children,
}: SortableItemProps) {
  return (
    <li
      ref={itemRef}
      style={style}
      data-selected={selected || dragging}
      className={`relative flex min-h-14 items-center gap-2 rounded-lg border border-border py-2 pr-2 pl-1 md:gap-3 md:pl-2 ${
        selected || dragging ? "bg-muted" : "bg-background"
      } ${dragging ? "z-10 shadow-md" : ""}`}
    >
      <Button
        ref={handleRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={handleLabel}
        className="size-10 shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing md:size-7"
        {...handleProps}
      >
        <GripVertical aria-hidden="true" />
      </Button>
      {children}
    </li>
  );
}
