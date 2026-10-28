import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Info } from "lucide-react";
import Link from "next/link";

// O aviso de um registro em conflito com "Resolver conflito" (Figma 55:5132, o estado 5 da tela de campo), igual no
// formulário de cliente e de imóvel: o Alert warning e o botão que abre o ConflictResolver. Específico do vistoria
// (ADR 0020).

type ConflictNoticeProps = {
  /** "Esta vistoria foi alterada em outro aparelho". */
  title: string;
  description: string;
  /** O ConflictResolver do registro. */
  href: string;
  className?: string;
};

export function ConflictNotice({ title, description, href, className = "" }: ConflictNoticeProps) {
  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      <Alert variant="warning">
        <Info aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      <Button asChild size="lg" className="w-full md:h-8 md:w-auto md:px-3">
        <Link href={href}>Resolver conflito</Link>
      </Button>
    </div>
  );
}
