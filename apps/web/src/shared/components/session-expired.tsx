import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Clock, TriangleAlert } from "lucide-react";

// Figma SessionExpired (29:1393), em cima do formulário do /login: a sessão expirou e a outbox espera o login do
// mesmo usuário; nada é apagado. caso "com pendências" (warning) diz quantas alterações esperam; "sem
// pendências" (neutral) só pede o login. O caso "outro usuário" (apagar o banco do anterior) é do M4.

export function SessionExpired({ pending }: { pending: number }) {
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
