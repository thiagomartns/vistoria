import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Clock, TriangleAlert } from "lucide-react";

// Figma SessionExpired (29:1393), em cima do formulário do /login: a sessão expirou e a outbox espera o login do
// mesmo usuário; nada é apagado. caso "com pendências" (warning) diz quantas alterações esperam; "sem
// pendências" (neutral) só pede o login. caso "outro usuário" (danger, frame 2 da #128): entrou uma conta diferente
// do dono das pendências; o aviso cita o nome do anterior (o dono guardado no aparelho só tem `id` e nome) e o número
// de alterações, e "Apagar e entrar" apaga o banco local dele; "Cancelar" volta ao formulário sem mudar nada.

type SessionExpiredProps =
  | { pending: number; otherUser?: never }
  | {
      pending?: never;
      otherUser: {
        /** O nome do dono anterior, cujas alterações se perdem. */
        previousName: string;
        pending: number;
        /** A decisão está saindo: os dois botões ficam desabilitados. */
        busy?: boolean;
        onCancel: () => void;
        onConfirm: () => void;
      };
    };

export function SessionExpired(props: SessionExpiredProps) {
  if (props.otherUser) {
    const { previousName, pending, busy, onCancel, onConfirm } = props.otherUser;
    const changes = pending === 1 ? "Há 1 alteração" : `Há ${pending} alterações`;
    const sent = pending === 1 ? "ainda não foi enviada" : "ainda não foram enviadas";
    const them = pending === 1 ? "ela é apagada" : "elas são apagadas";
    return (
      <Alert variant="danger" role="alert">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>As alterações da outra conta serão apagadas</AlertTitle>
        <AlertDescription>
          {changes} de {previousName} que {sent}. Ao entrar com outra conta, {them} deste aparelho.
        </AlertDescription>
        <div className="col-span-2 mt-2.5 flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            Apagar e entrar
          </Button>
        </div>
      </Alert>
    );
  }

  const { pending } = props;
  if (pending === 0) {
    return (
      <Alert variant="neutral" role="status">
        <Clock aria-hidden="true" />
        <AlertTitle>Sua sessão expirou</AlertTitle>
        <AlertDescription>Entre novamente para continuar.</AlertDescription>
      </Alert>
    );
  }

  const changes = pending === 1 ? "a alteração salva" : `as ${pending} alterações salvas`;
  return (
    <Alert variant="warning" role="status">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>Sua sessão expirou</AlertTitle>
      <AlertDescription>
        Entre novamente para enviar {changes} neste aparelho. Nada foi perdido.
      </AlertDescription>
    </Alert>
  );
}
