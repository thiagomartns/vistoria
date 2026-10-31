import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { CloudOff } from "lucide-react";

// Topo do conteúdo (Figma OfflineBanner 12:1345). aviso: Alert warning discreto quando offline. bloqueio: cobre o
// conteúdo quando a janela offline de 72 h vence, contada da última renovação aceita (refresh ou login), não do último
// sync (frame 8 da #128); nada é apagado, e um refresh aceito libera.

type OfflineBannerProps =
  | { type: "aviso" }
  | { type: "bloqueio"; pending: number; onRetry: () => void };

export function OfflineBanner(props: OfflineBannerProps) {
  if (props.type === "aviso") {
    return (
      <Alert variant="warning" role="status">
        <CloudOff aria-hidden="true" />
        <AlertTitle>Você está offline</AlertTitle>
        <AlertDescription>
          O que você registrar fica salvo neste aparelho e é enviado quando a conexão voltar.
        </AlertDescription>
      </Alert>
    );
  }

  const kept =
    props.pending === 0
      ? ""
      : props.pending === 1
        ? " a alteração pendente continua salva aqui."
        : ` as ${props.pending} alterações pendentes continuam salvas aqui.`;
  return (
    <div role="alert" className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-warning-subtle">
          <CloudOff className="size-6 text-warning-text" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold text-foreground">Reconecte para continuar</h2>
        <p className="text-sm text-muted-foreground">
          Faz mais de 72 horas que este aparelho não confirma sua sessão. Nada foi apagado
          {kept ? `:${kept}` : "."}
        </p>
        <Button onClick={props.onRetry}>Tentar novamente</Button>
      </div>
    </div>
  );
}
