import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@sanjou/ui/form";
import { Input } from "@sanjou/ui/input";
import { Check, Plus, Trash2 } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Sheet } from "@/shared/components/sheet";
import { SortableList, SortableRow } from "@/shared/components/sortable-list";

import type { InspectionFormValues } from "../schemas/inspection.schemas";

// Os ambientes da vistoria (Figma "Ambientes e itens (#171)", estados 7 e 8): o Sheet aberto pelo "Editar ambientes" do
// "···", com a lista reordenável pela alça, o nome em campo, a lixeira, "Adicionar ambiente" (desabilita no limite) e
// "Pronto". Remover um ambiente com itens pede o Dialog. Nada vai para o servidor aqui: o formulário muda, e o rascunho
// e a fila seguem como em qualquer mudança. Fechar com um nome errado não fecha (o hook confere). O `form` vem do hook.

type RoomsSheetProps = {
  form: UseFormReturn<InspectionFormValues>;
  open: boolean;
  /** Os ambientes na ordem da lista, com o nome (ou "Ambiente sem nome"). */
  rooms: { id: string; name: string }[];
  max: number;
  onClose: () => void;
  onAdd: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  /** O ambiente com itens esperando a confirmação para sair, ou null. */
  removal: { description: string } | null;
  onConfirmRemoval: () => void;
  onCancelRemoval: () => void;
};

export const ROOMS_SHEET_DESCRIPTION = "Arraste pela alça para mudar a ordem.";

export function RoomsSheet({
  form,
  open,
  rooms,
  max,
  onClose,
  onAdd,
  onMove,
  onRemove,
  removal,
  onConfirmRemoval,
  onCancelRemoval,
}: RoomsSheetProps) {
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => (next ? undefined : onClose())}
        title="Ambientes"
        description={`${rooms.length} de ${max} · ${ROOMS_SHEET_DESCRIPTION}`}
      >
        <Form {...form}>
          <div className="flex flex-col gap-2 px-5 pb-6">
            <SortableList
              ids={rooms.map((room) => room.id)}
              names={rooms.map((room) => room.name)}
              onMove={onMove}
              label="Ambientes"
            >
              {rooms.map((room, index) => (
                <SortableRow key={room.id} id={room.id} handleLabel={`Mover ${room.name}`}>
                  <FormField
                    control={form.control}
                    name={`rooms.${index}.name`}
                    render={({ field }) => (
                      <FormItem className="min-w-0 flex-1 gap-1">
                        <FormControl>
                          <Input
                            autoComplete="off"
                            aria-label={`Nome do ambiente ${index + 1}`}
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              form.clearErrors(`rooms.${index}.name`);
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
                    aria-label={`Remover ${room.name}`}
                    className="shrink-0"
                    disabled={rooms.length <= 1}
                    onClick={() => onRemove(index)}
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
              className="w-full"
              disabled={rooms.length >= max}
              onClick={onAdd}
            >
              <Plus aria-hidden="true" />
              Adicionar ambiente
            </Button>
            <Button type="button" size="lg" className="w-full" onClick={onClose}>
              <Check aria-hidden="true" />
              Pronto
            </Button>
          </div>
        </Form>
      </Sheet>
      <Dialog
        open={removal !== null}
        onOpenChange={(next) => (next ? undefined : onCancelRemoval())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover ambiente?</DialogTitle>
            <DialogDescription>{removal?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCancelRemoval}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={onConfirmRemoval}>
              Remover ambiente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
