import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";

// Concluir a vistoria (Figma 164:12824, estado 2): "Concluir vistoria" no último ambiente, sem nada faltando, pede
// confirmação neste Dialog. Com alteração ainda não enviada ou sem rede, ele diz que a conclusão sai quando a conexão
// voltar. Quem usa abre o Dialog (depois de conferir o que falta) e decide o que o confirmar faz.

export const COMPLETE_TITLE = "Concluir esta vistoria?";
export const COMPLETE_ACTION = "Concluir vistoria";

type CompleteInspectionProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Apto 302 · R. das Flores, 120 · Vistoria de entrada". */
  subject: string;
  /** Há alteração que o servidor ainda não tem, ou não há rede. */
  pending: boolean;
  onConfirm: () => void;
};

export function CompleteInspection({
  open,
  onOpenChange,
  subject,
  pending,
  onConfirm,
}: CompleteInspectionProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{COMPLETE_TITLE}</DialogTitle>
          <DialogDescription>
            {subject}. Depois de concluída, ela fica travada e não pode mais ser editada.
            {pending ? " Sem rede, a conclusão sai quando a conexão voltar." : null}
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
            {COMPLETE_ACTION}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
