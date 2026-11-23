import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";

import type { EditNotice } from "../services/inspections.view";

// "Salvar as alterações do imóvel?" (ou do cliente) sobre o formulário (Figma "Salvar com vistorias (#234)"): só
// informa o que muda nas vistorias. "Salvar" grava como sem o aviso; "Voltar" fecha sem salvar.

type SaveWithInspectionsDialogProps = {
  /** O aviso esperando a resposta, ou null com o Dialog fechado. */
  notice: EditNotice | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SaveWithInspectionsDialog({
  notice,
  onConfirm,
  onCancel,
}: SaveWithInspectionsDialogProps) {
  return (
    <Dialog open={notice !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notice?.title}</DialogTitle>
          <DialogDescription>{notice?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Voltar
          </Button>
          <Button onClick={onConfirm}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
