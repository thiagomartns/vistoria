import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { CloudOff } from "lucide-react";

// Topo do conteúdo (Figma OfflineBanner 12:1345). aviso: Alert warning discreto quando offline. bloqueio: cobre o
// conteúdo quando a janela offline de 72 h vence; nada é apagado (a janela é do M4).

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

  const changes = `${props.pending} ${props.pending === 1 ? "alteração pendente" : "alterações pendentes"}`;
  return (
    <div role="alert" className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-warning-subtle">
          <CloudOff className="size-6 text-warning-text" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold text-foreground">Conexão necessária</h2>
        <p className="text-sm text-muted-foreground">
          Conecte-se à internet para continuar. O aplicativo está há mais de 72 horas sem
          sincronizar. Seus dados estão salvos neste dispositivo ({changes}).
        </p>
        <Button onClick={props.onRetry}>Tentar novamente</Button>
      </div>
    </div>
  );
}
