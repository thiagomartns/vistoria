import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";

// Começar uma vistoria que costuma ser engano pede confirmação neste Dialog, no molde do "Concluir vistoria": outra
// saída de uma entrada que já tem saída (#184, ADR 0059) e outra entrada num imóvel com entrada em andamento (#235,
// Figma "Nova vistoria · entrada em andamento"). Os textos vêm de quem usa; Cancelar não cria nada.

type ConfirmStartProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** O botão que começa mesmo assim: "Começar outra saída". */
  action: string;
  onConfirm: () => void;
};

export function ConfirmStart({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
}: ConfirmStartProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
