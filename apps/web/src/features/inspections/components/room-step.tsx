import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@sanjou/ui/form";
import { Input } from "@sanjou/ui/input";
import { Textarea } from "@sanjou/ui/textarea";
import { Check, CircleAlert, Info, ListChecks, Plus, Trash2 } from "lucide-react";
import { type UseFormReturn, useFieldArray, useWatch } from "react-hook-form";

import { ConflictNotice } from "@/shared/components/conflict-notice";
import { EmptyState } from "@/shared/components/empty-state";
import type { FieldSyncState } from "@/shared/components/field-sync-indicator";
import { InspectionItem } from "@/shared/components/inspection-item";
import { SortableList, SortableRow } from "@/shared/components/sortable-list";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/toggle-group";

import type { InspectionFormValues, ItemFormValues } from "../schemas/inspection.schemas";

// Um ambiente da tela de campo (Figma 43:1751): o nome e o progresso, os itens com a condição em chips e a observação
// sob demanda, e no topo o aviso de recusa do servidor (55:5920) ou do que falta para concluir (164:12824, estado 3), o
// de conflito, com "Resolver conflito" (55:5132), o da exclusão na fila (estado 6 do #107) ou o da concluída, confirmada
// ou com a conclusão na fila (164:12824, estados 4 e 5). Na saída, cada item mostra o que tinha na entrada (52:2538).
// Ambientes e itens (#171, "Ambientes e itens (#171)"): "Adicionar item" e "Editar itens" no cabeçalho (no celular, no
// fim da lista; no ambiente vazio, no EmptyState); em edição, os chips dão lugar às linhas com a alça, o nome e a
// lixeira, com o contador e "Pronto". Só leitura, nada disso aparece. O `form` vem do hook da página.

export interface RoomItemView {
  id: string;
  name: string;
  /** O índice do item no ambiente (o caminho no formulário). */
  index: number;
  sync?: FieldSyncState;
  /** Só na saída: a condição e a observação da entrada, ao lado do item (Figma 42:1632 e 42:1715). */
  reference?: { condition: string; notes: string | null };
}

type Condition = NonNullable<ItemFormValues["condition"]>;

type RoomStepProps = {
  form: UseFormReturn<InspectionFormValues>;
  /** Os chips de condição, na ordem. */
  conditions: { value: Condition; label: string }[];
  /** O tamanho máximo da observação, do contrato. */
  notesMax: number;
  roomIndex: number;
  name: string;
  /** "3 de 8 itens avaliados". */
  progress: string;
  items: RoomItemView[];
  readOnly: boolean;
  rejection: { title: string; description: string } | null;
  /** Estado 5: a vistoria mudou em outro aparelho; o botão abre o ConflictResolver. */
  conflict?: { title: string; description: string; href: string } | null;
  /** A exclusão está na fila: a tela é só leitura. */
  deletion?: { title: string; description: string } | null;
  /** Concluída: "success" confirmada pelo servidor, "pending" com a conclusão na fila. A tela é só leitura. */
  completion?: { tone: "success" | "pending"; title: string; description: string } | null;
  /** Os itens em edição (nome, ordem, lixeira). */
  editing?: boolean;
  onEdit?: () => void;
  /** "Pronto": o hook confere os nomes antes de sair da edição. */
  onFinishEditing?: () => void;
  /** Até quantos itens o ambiente tem (o contador e o botão que desabilita no limite). */
  itemsMax?: number;
  /** Um item novo, com id. */
  newItem?: () => ItemFormValues;
};

export function RoomStep({
  form,
  conditions,
  notesMax,
  roomIndex,
  name,
  progress,
  items,
  readOnly,
  rejection,
  conflict,
  deletion,
  completion,
  editing = false,
  onEdit,
  onFinishEditing,
  itemsMax = 0,
  newItem,
}: RoomStepProps) {
  const path = `rooms.${roomIndex}.items` as const;
  const list = useFieldArray({ control: form.control, name: path });
  const values = useWatch({ control: form.control, name: path }) ?? [];
  const canEdit = !readOnly && onEdit !== undefined && newItem !== undefined;
  const full = list.fields.length >= itemsMax;
  const itemName = (position: number) => values[position]?.name.trim() || `Item ${position + 1}`;

  function addItem() {
    if (!newItem || full) return;
    list.append(newItem(), { focusName: `${path}.${list.fields.length}.name` });
    if (!editing) onEdit?.();
  }

  const addButton = (size: "sm" | "lg", className = "") => (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      disabled={full}
      onClick={addItem}
    >
      <Plus aria-hidden="true" />
      Adicionar item
    </Button>
  );
  const editButton = (size: "sm" | "lg", className = "") => (
    <Button type="button" variant="ghost" size={size} className={className} onClick={onEdit}>
      Editar itens
    </Button>
  );

  return (
    <Form {...form}>
      <section
        aria-labelledby="ambiente"
        className="flex flex-1 flex-col gap-2 px-4 pt-4 pb-4 md:px-6 md:pt-5"
      >
        {rejection ? (
          <Alert variant="danger" className="mb-2">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{rejection.title}</AlertTitle>
            <AlertDescription>{rejection.description}</AlertDescription>
          </Alert>
        ) : null}
        {conflict ? <ConflictNotice {...conflict} className="mb-2" /> : null}
        {deletion ? (
          <Alert variant="neutral" role="status" className="mb-2">
            <Trash2 aria-hidden="true" />
            <AlertTitle>{deletion.title}</AlertTitle>
            <AlertDescription>{deletion.description}</AlertDescription>
          </Alert>
        ) : null}
        {completion ? (
          <Alert
            variant={completion.tone === "success" ? "success" : "neutral"}
            role="status"
            className="mb-2"
          >
            <Info aria-hidden="true" />
            <AlertTitle>{completion.title}</AlertTitle>
            <AlertDescription>{completion.description}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id="ambiente" className="text-lg font-semibold text-foreground">
              {name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {editing ? `Editando itens · ${list.fields.length} de ${itemsMax}` : progress}
            </p>
          </div>
          {canEdit && editing ? (
            <div className="flex shrink-0 items-center gap-2">
              {addButton("sm", "hidden md:inline-flex")}
              <Button type="button" size="sm" onClick={onFinishEditing}>
                <Check aria-hidden="true" />
                Pronto
              </Button>
            </div>
          ) : canEdit && items.length > 0 ? (
            <div className="hidden shrink-0 items-center gap-2 md:flex">
              {editButton("sm")}
              {addButton("sm")}
            </div>
          ) : null}
        </div>
        {canEdit && editing ? (
          <div className="flex flex-col gap-2 pt-2">
            <SortableList
              ids={list.fields.map((item) => item.itemId)}
              names={list.fields.map((_, position) => itemName(position))}
              onMove={list.move}
              label="Itens"
            >
              {list.fields.map((item, position) => (
                <SortableRow
                  key={item.itemId}
                  id={item.itemId}
                  handleLabel={`Mover ${itemName(position)}`}
                >
                  <FormField
                    control={form.control}
                    name={`${path}.${position}.name`}
                    render={({ field }) => (
                      <FormItem className="min-w-0 flex-1 gap-1">
                        <FormControl>
                          <Input
                            autoComplete="off"
                            aria-label={`Nome do item ${position + 1}`}
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              form.clearErrors(`${path}.${position}.name`);
                            }}
                          />
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
                    onClick={() => list.remove(position)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </SortableRow>
              ))}
            </SortableList>
            {addButton("lg", "w-full md:hidden")}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nenhum item neste ambiente"
            description={
              canEdit
                ? "Adicione os itens que vai avaliar, como piso, paredes e janelas."
                : "Este ambiente não tem itens."
            }
            action={
              canEdit ? (
                <Button type="button" disabled={full} onClick={addItem}>
                  <Plus aria-hidden="true" />
                  Adicionar item
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col">
            {items.map((item) => {
              const base = `rooms.${roomIndex}.items.${item.index}` as const;
              return (
                <FormField
                  key={item.id}
                  control={form.control}
                  name={`${base}.condition`}
                  render={({ field, fieldState }) => (
                    <FormItem className="block">
                      <InspectionItem
                        name={item.name}
                        sync={item.sync}
                        reference={item.reference}
                        readOnly={readOnly}
                        hasNotes={form.getValues(`${base}.notes`) !== ""}
                        condition={
                          <FormControl>
                            <ToggleGroup
                              aria-label={`Condição: ${item.name}`}
                              value={field.value}
                              values={conditions.map((condition) => condition.value)}
                              onValueChange={(value) => {
                                field.onChange(value as Condition);
                                form.clearErrors(`${base}.condition`);
                              }}
                              size="auto"
                              invalid={fieldState.invalid}
                              readOnly={readOnly}
                            >
                              {conditions.map((condition) => (
                                <ToggleGroupItem key={condition.value} value={condition.value}>
                                  {condition.label}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          </FormControl>
                        }
                        error={fieldState.error ? <FormMessage /> : null}
                        notes={
                          <FormField
                            control={form.control}
                            name={`${base}.notes`}
                            render={({ field: notes }) => (
                              <FormItem>
                                <FormControl>
                                  <Textarea
                                    aria-label={`Observação: ${item.name}`}
                                    maxLength={notesMax}
                                    readOnly={readOnly}
                                    className="read-only:bg-muted read-only:text-muted-foreground"
                                    {...notes}
                                    onChange={(event) => {
                                      notes.onChange(event);
                                      form.clearErrors(`${base}.notes`);
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        }
                      />
                    </FormItem>
                  )}
                />
              );
            })}
            {canEdit ? (
              <div className="flex gap-2 pt-4 md:hidden">
                {addButton("lg", "flex-1")}
                {editButton("lg", "flex-1")}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </Form>
  );
}
