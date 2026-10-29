import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { CircleAlert } from "lucide-react";
import Link from "next/link";

/**
 * O lugar de um registro que a tela não tem para mostrar (sem rede, não encontrado ou falha do servidor): o aviso e
 * "Voltar para a lista", com "Tentar de novo" quando dá para buscar outra vez.
 */
export function RecordUnavailable({
  description,
  backHref,
  onRetry,
}: {
  description: string;
  backHref: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Alert variant="warning" role="status">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        {onRetry ? (
          <Button type="button" onClick={onRetry}>
            Tentar de novo
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={backHref}>Voltar para a lista</Link>
        </Button>
      </div>
    </div>
  );
}
