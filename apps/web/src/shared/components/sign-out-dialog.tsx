import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";

// "Sair" com pendências (frames 4 e 5 da #128): o Dialog avisa que as alterações ainda não enviadas são apagadas deste
// aparelho e não dá para desfazer; sem rede, a frase a mais diz que elas não têm como sair agora. Sem pendências, o
// shell nem abre o Dialog: sai e limpa direto. Específico do vistoria (ADR 0020).

export const SIGN_OUT_TITLE = "Sair e apagar as alterações deste aparelho?";

type SignOutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: number;
  offline: boolean;
  /** A saída está em andamento: os botões ficam desabilitados. */
  busy?: boolean;
  onConfirm: () => void;
};

export function SignOutDialog({
  open,
  onOpenChange,
  pending,
  offline,
  busy,
  onConfirm,
}: SignOutDialogProps) {
  const changes =
    pending === 1
      ? "Há 1 alteração que ainda não foi enviada. Ao sair, ela é apagada"
      : `Há ${pending} alterações que ainda não foram enviadas. Ao sair, elas são apagadas`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{SIGN_OUT_TITLE}</DialogTitle>
          <DialogDescription>
            {changes} deste aparelho e não dá para desfazer.
            {offline
              ? ` Sem rede, ${pending === 1 ? "ela não tem" : "elas não têm"} como ser ${pending === 1 ? "enviada" : "enviadas"} agora: conecte-se e espere o envio para não perder nada.`
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            Sair e apagar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
