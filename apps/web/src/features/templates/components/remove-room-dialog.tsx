import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sanjou/ui/dialog";

// "Remover ambiente?" sobre o editor de roteiro (Figma "Roteiros (#173)", estado 8): só para o ambiente com itens. Nada
// vai para o servidor aqui; o roteiro só muda ao salvar.

type RemoveRoomDialogProps = {
  /** O ambiente esperando a confirmação, ou null com o Dialog fechado. */
  room: { name: string; itemCount: number } | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function RemoveRoomDialog({ room, onConfirm, onCancel }: RemoveRoomDialogProps) {
  return (
    <Dialog open={room !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover ambiente?</DialogTitle>
          <DialogDescription>
            {room
              ? `${room.name} tem ${room.itemCount} ${room.itemCount === 1 ? "item" : "itens"}. ${
                  room.itemCount === 1 ? "Ele sai" : "Eles saem"
                } do roteiro junto com o ambiente.`
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Remover ambiente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
