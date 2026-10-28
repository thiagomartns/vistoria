import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@sanjou/ui/dropdown-menu";
import { Ellipsis, Trash2 } from "lucide-react";
import { useState } from "react";

// Excluir uma vistoria em andamento (frames do #107): o "···" (Mais ações) abre um DropdownMenu só com "Excluir
// vistoria", que pede confirmação num Dialog. Com alteração ainda não enviada, o Dialog diz que ela é descartada e que,
// sem rede, a exclusão sai quando a conexão voltar (estado 3). Fica no header da tela de campo e na linha da lista
// (desktop); quem usa decide quando ele aparece (nunca na concluída nem na que já está saindo).

export const DELETE_TITLE = "Excluir esta vistoria?";

type DeleteInspectionProps = {
  /** "Apto 302 · R. das Flores, 120 · Vistoria de entrada". */
  subject: string;
  /** Há alteração da vistoria que o servidor ainda não tem. */
  pending: boolean;
  onConfirm: () => void;
  className?: string;
};

export function DeleteInspection({
  subject,
  pending,
  onConfirm,
  className,
}: DeleteInspectionProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {/* Sem modal: o menu fecha antes de o Dialog abrir, sem disputar o foco e o pointer-events do body. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Mais ações" className={className}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2 aria-hidden="true" />
            Excluir vistoria
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{DELETE_TITLE}</DialogTitle>
            <DialogDescription>
              {subject}. Ela sai deste aparelho e do servidor, e não dá para desfazer.
              {pending
                ? " As alterações ainda não enviadas também são descartadas. Sem rede, a exclusão sai quando a conexão voltar."
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              Excluir vistoria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
