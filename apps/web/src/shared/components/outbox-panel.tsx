import { Badge } from "@sanjou/ui/badge";
import { Button } from "@sanjou/ui/button";
import {
  CircleAlert,
  Clock,
  CloudAlert,
  type LucideIcon,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import type { OutboxItemState, OutboxItemView } from "@/shared/sync/sync-view";

import { Sheet } from "./sheet";

// Pendências da outbox, aberto pelo SyncStatus (Figma OutboxPanel 13:1153, OutboxPanel/Item 13:932). Grupos: ação
// necessária (conflito, rejeitada), falha no envio (travadas), aguardando envio. Sempre ícone + texto.

const ICON: Record<OutboxItemState, { icon: LucideIcon; className: string }> = {
  pendente: { icon: Clock, className: "text-muted-foreground" },
  enviando: { icon: RefreshCw, className: "text-brand-text" },
  travada: { icon: TriangleAlert, className: "text-warning-text" },
  conflito: { icon: CloudAlert, className: "text-danger-text" },
  rejeitada: { icon: CircleAlert, className: "text-danger-text" },
};

type OutboxPanelItemProps = OutboxItemView & {
  /** Só a pendente que nunca foi tentada pode ser cancelada. */
  onCancel?: () => void;
  /** Conflito: abre o ConflictResolver. */
  onResolve?: () => void;
  /** Rejeitada: abre o registro com os erros. */
  onOpen?: () => void;
};

export function OutboxPanelItem({
  state,
  title,
  detail,
  onCancel,
  onResolve,
  onOpen,
}: OutboxPanelItemProps) {
  const { icon: Icon, className } = ICON[state];
  const stuck = state === "travada";
  return (
    <li
      data-state={state}
      className={`flex min-h-14 items-center gap-3 rounded-md p-3 ${stuck ? "bg-warning-subtle" : "border border-border"}`}
    >
      <Icon className={`size-4 shrink-0 ${className}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className={`text-xs ${stuck ? "text-warning-text" : "text-muted-foreground"}`}>
          {detail}
        </p>
      </div>
      {stuck ? <Badge variant="warning">Falha no envio</Badge> : null}
      {state === "pendente" && onCancel ? (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      ) : null}
      {state === "conflito" && onResolve ? (
        <Button variant="outline" size="sm" onClick={onResolve}>
          Resolver
        </Button>
      ) : null}
      {state === "rejeitada" && onOpen ? (
        <Button variant="outline" size="sm" onClick={onOpen}>
          Abrir
        </Button>
      ) : null}
    </li>
  );
}

function Group({
  title,
  items,
  onResolve,
}: {
  title: string;
  items: OutboxItemView[];
  onResolve?: (item: OutboxItemView) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <OutboxPanelItem
            key={item.id}
            {...item}
            onResolve={item.href && onResolve ? () => onResolve(item) : undefined}
          />
        ))}
      </ul>
    </section>
  );
}

type OutboxPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  actionNeeded: OutboxItemView[];
  failing: OutboxItemView[];
  waiting: OutboxItemView[];
  onRetryNow: () => void;
  /** "Resolver" num conflito: abre a tela do `href` dele. */
  onResolve?: (item: OutboxItemView) => void;
};

export function OutboxPanel({
  open,
  onOpenChange,
  description,
  actionNeeded,
  failing,
  waiting,
  onRetryNow,
  onResolve,
}: OutboxPanelProps) {
  const pending = actionNeeded.length + failing.length + waiting.length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Pendências" description={description}>
      <div className="flex flex-col gap-5 px-5 pb-5">
        <Group title="Ação necessária" items={actionNeeded} onResolve={onResolve} />
        <Group title="Falha no envio" items={failing} />
        <Group title="Aguardando envio" items={waiting} />
        {pending > 0 ? (
          <Button variant="outline" className="w-full" onClick={onRetryNow}>
            Tentar agora
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
