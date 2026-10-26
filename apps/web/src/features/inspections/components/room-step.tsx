import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@sanjou/ui/form";
import { Textarea } from "@sanjou/ui/textarea";
import { CircleAlert, ListChecks } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { EmptyState } from "@/shared/components/empty-state";
import type { FieldSyncState } from "@/shared/components/field-sync-indicator";
import { InspectionItem } from "@/shared/components/inspection-item";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/toggle-group";

import type { InspectionFormValues, ItemFormValues } from "../schemas/inspection.schemas";

// Um ambiente da tela de campo (Figma 43:1751): o nome e o progresso, os itens com a condição em chips e a observação
// sob demanda, e o aviso de recusa do servidor no topo (55:5920). Ambiente sem itens mostra o EmptyState (52:4071),
// sem ação: incluir itens chega com o editor de roteiros (M5). O `form` vem do hook da página.

export interface RoomItemView {
  id: string;
  name: string;
  /** O índice do item no ambiente (o caminho no formulário). */
  index: number;
  sync?: FieldSyncState;
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
}: RoomStepProps) {
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
        <div className="flex flex-col gap-0.5">
          <h2 id="ambiente" className="text-lg font-semibold text-foreground">
            {name}
          </h2>
          <p className="text-sm text-muted-foreground">{progress}</p>
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nenhum item neste ambiente"
            description="Este ambiente veio do roteiro sem itens."
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
          </div>
        )}
      </section>
    </Form>
  );
}
