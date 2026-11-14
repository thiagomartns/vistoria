import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@sanjou/ui/form";
import { Input } from "@sanjou/ui/input";
import { ChevronRight, CircleAlert, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import type { FormEventHandler } from "react";
import { type Control, type UseFormReturn, useFieldArray, useWatch } from "react-hook-form";

import { SortableList, SortableRow } from "@/shared/components/sortable-list";

// O editor de /templates/edit (Figma "Roteiros (#173)", estados 3 a 5). No desktop, o nome do roteiro e dois painéis:
// os ambientes à esquerda (o selecionado abre os itens à direita) e o ambiente aberto, com o nome, "Remover
// ambiente" e os itens. No celular, dois níveis na mesma rota: o nome e os ambientes, com Salvar e Cancelar; e, ao
// tocar num ambiente, o nome dele e os itens (o "Voltar" do cabeçalho volta, sem perder nada). Ambientes e itens se
// reordenam pela alça. Os botões de adicionar desabilitam no limite do contrato. O `form` vem do hook da página.

type ItemFields = { itemId: string; name: string };
type RoomFields = { roomId: string; name: string; items: ItemFields[] };
export type TemplateFormFields = { name: string; rooms: RoomFields[] };

export interface RoomRowView {
  id: string;
  /** O nome, ou "Ambiente sem nome". */
  name: string;
  /** "7 itens · 1 correção". */
  detail: string;
}

type TemplateFormProps<TOutput> = {
  form: UseFormReturn<TemplateFormFields, unknown, TOutput>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  layout: "desktop" | "celular";
  rooms: RoomRowView[];
  /** O índice do ambiente aberto. */
  selected: number;
  /** Celular: o segundo nível (os itens do ambiente aberto). */
  open: boolean;
  roomsMax: number;
  itemsMax: number;
  onSelect: (index: number) => void;
  onAddRoom: () => void;
  onMoveRoom: (from: number, to: number) => void;
  onRemoveRoom: (index: number) => void;
  /** Um item novo, com id. */
  newItem: () => ItemFields;
  rejection: { title: string; description: string } | null;
  cancelHref: string;
};

const fill = "w-full lg:h-8 lg:w-auto lg:px-3";

export function TemplateForm<TOutput>({
  form,
  onSubmit,
  layout,
  rooms,
  selected,
  open,
  roomsMax,
  itemsMax,
  onSelect,
  onAddRoom,
  onMoveRoom,
  onRemoveRoom,
  newItem,
  rejection,
  cancelHref,
}: TemplateFormProps<TOutput>) {
  // O FormField do Sanjou não tem o tipo dos valores transformados (o schema troca os ids e soma a posição ao salvar);
  // para desenhar os campos, só os valores de entrada importam.
  const control = form.control as unknown as Control<TemplateFormFields>;
  const desktop = layout === "desktop";
  const room = rooms[selected];

  const roomPanel = room ? (
    <RoomPanel
      key={room.id}
      control={control}
      index={selected}
      itemsMax={itemsMax}
      newItem={newItem}
      onRemove={() => onRemoveRoom(selected)}
      desktop={desktop}
    />
  ) : (
    <p className="text-sm text-muted-foreground">Adicione um ambiente para incluir itens.</p>
  );

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-5">
        {rejection ? (
          <Alert variant="danger">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{rejection.title}</AlertTitle>
            <AlertDescription>{rejection.description}</AlertDescription>
          </Alert>
        ) : null}
        {!desktop && open ? (
          roomPanel
        ) : (
          <>
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem className="lg:max-w-[560px]">
                  <FormLabel>Nome do roteiro</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {desktop ? (
              <div className="flex items-start gap-6">
                <RoomsPanel
                  rooms={rooms}
                  selected={selected}
                  highlight
                  roomsMax={roomsMax}
                  onSelect={onSelect}
                  onAdd={onAddRoom}
                  onMove={onMoveRoom}
                  className="w-[360px] shrink-0"
                />
                <div className="min-w-0 flex-1 border-l border-border pl-6">{roomPanel}</div>
              </div>
            ) : (
              <RoomsPanel
                rooms={rooms}
                selected={selected}
                roomsMax={roomsMax}
                onSelect={onSelect}
                onAdd={onAddRoom}
                onMove={onMoveRoom}
              />
            )}
            <div className="flex flex-col gap-2 lg:flex-row">
              <Button type="submit" size="lg" className={fill}>
                Salvar roteiro
              </Button>
              <Button asChild variant="ghost" size="lg" className={fill}>
                <Link href={cancelHref}>Cancelar</Link>
              </Button>
            </div>
          </>
        )}
      </form>
    </Form>
  );
}

function Counter({ title, count, max }: { title: string; count: number; max: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} de {max}
      </span>
    </div>
  );
}

type RoomsPanelProps = {
  rooms: RoomRowView[];
  selected: number;
  /** Desktop: o ambiente aberto fica em "selecionado". */
  highlight?: boolean;
  roomsMax: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onMove: (from: number, to: number) => void;
  className?: string;
};

/** Os ambientes: a lista que abre cada um, reordenável, e "Adicionar ambiente". */
function RoomsPanel({
  rooms,
  selected,
  highlight = false,
  roomsMax,
  onSelect,
  onAdd,
  onMove,
  className = "",
}: RoomsPanelProps) {
  return (
    <section aria-label="Ambientes" className={`flex flex-col gap-2 ${className}`}>
      <Counter title="Ambientes" count={rooms.length} max={roomsMax} />
      <SortableList
        ids={rooms.map((room) => room.id)}
        names={rooms.map((room) => room.name)}
        onMove={onMove}
        label="Ambientes"
      >
        {rooms.map((room, index) => (
          <SortableRow
            key={room.id}
            id={room.id}
            handleLabel={`Mover ${room.name}`}
            selected={highlight && index === selected}
          >
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-current={highlight && index === selected ? "true" : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{room.name}</span>
                <span className="truncate text-xs text-muted-foreground">{room.detail}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </SortableRow>
        ))}
      </SortableList>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full lg:h-8"
        onClick={onAdd}
        disabled={rooms.length >= roomsMax}
      >
        <Plus aria-hidden="true" />
        Adicionar ambiente
      </Button>
    </section>
  );
}

type RoomPanelProps = {
  control: Control<TemplateFormFields>;
  index: number;
  itemsMax: number;
  newItem: () => ItemFields;
  onRemove: () => void;
  desktop: boolean;
};

/** O ambiente aberto: o nome, "Remover ambiente" e os itens, reordenáveis, com "Adicionar item". */
function RoomPanel({ control, index, itemsMax, newItem, onRemove, desktop }: RoomPanelProps) {
  const name = `rooms.${index}.items` as const;
  const items = useFieldArray({ control, name });
  const values = useWatch({ control, name }) ?? [];
  const itemName = (position: number) => values[position]?.name.trim() || `Item ${position + 1}`;
  const remove = (
    <Button
      type="button"
      variant="ghost"
      size={desktop ? "md" : "lg"}
      className={desktop ? "mt-6 shrink-0" : "w-full"}
      onClick={onRemove}
    >
      <Trash2 aria-hidden="true" />
      Remover ambiente
    </Button>
  );

  return (
    <section aria-label="Itens do ambiente" className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <FormField
          control={control}
          name={`rooms.${index}.name`}
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1">
              <FormLabel>Nome do ambiente</FormLabel>
              <FormControl>
                <Input autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {desktop ? remove : null}
      </div>
      <div className="flex flex-col gap-2">
        <Counter title="Itens" count={items.fields.length} max={itemsMax} />
        <SortableList
          ids={items.fields.map((item) => item.itemId)}
          names={items.fields.map((_, position) => itemName(position))}
          onMove={items.move}
          label="Itens"
        >
          {items.fields.map((item, position) => (
            <SortableRow
              key={item.itemId}
              id={item.itemId}
              handleLabel={`Mover ${itemName(position)}`}
            >
              <FormField
                control={control}
                name={`${name}.${position}.name`}
                render={({ field }) => (
                  <FormItem className="min-w-0 flex-1 gap-1">
                    <FormControl>
                      <Input autoComplete="off" aria-label={`Item ${position + 1}`} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover ${itemName(position)}`}
                className="shrink-0"
                onClick={() => items.remove(position)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </SortableRow>
          ))}
        </SortableList>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full lg:h-8 lg:w-auto lg:self-start lg:px-3"
          disabled={items.fields.length >= itemsMax}
          onClick={() =>
            items.append(newItem(), { focusName: `${name}.${items.fields.length}.name` })
          }
        >
          <Plus aria-hidden="true" />
          Adicionar item
        </Button>
      </div>
      {desktop ? null : remove}
    </section>
  );
}
