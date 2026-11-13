import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";

// Outra saída da mesma entrada (#184, ADR 0059): na Nova vistoria, "Começar vistoria" com uma entrada que já tem saída
// no aparelho pede confirmação neste Dialog, no molde do "Concluir vistoria". Cancelar não cria nada.

export const EXISTING_MOVE_OUT_TITLE = "Esta entrada já tem saída";
export const EXISTING_MOVE_OUT_ACTION = "Começar outra saída";

type ExistingMoveOutProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Entrada de 20/10/2026 às 14:30". */
  subject: string;
  onConfirm: () => void;
};

export function ExistingMoveOut({ open, onOpenChange, subject, onConfirm }: ExistingMoveOutProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{EXISTING_MOVE_OUT_TITLE}</DialogTitle>
          <DialogDescription>
            {subject}. Já existe uma saída feita a partir dela; outra saída da mesma entrada costuma
            ser engano.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {EXISTING_MOVE_OUT_ACTION}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
