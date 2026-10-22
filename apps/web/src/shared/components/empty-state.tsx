import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Estado vazio de lista (Figma EmptyState 64:1722): ícone num círculo muted de 48, título, descrição e uma ação
// primária opcional. Ocupa a largura do container. Candidato ao Sanjou.

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** O botão da ação (um `Button` do Sanjou), quando houver. */
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-foreground" aria-hidden="true" />
      </span>
      <div className="flex w-full max-w-md flex-col gap-1">
        <h2 className="text-md font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
