import { CircleCheck, CloudAlert, CloudOff, type LucideIcon, RefreshCw } from "lucide-react";

import type { SyncStatusState } from "@/shared/sync/sync-view";

// Estado do sync no header (Figma SyncStatus 12:1307); um toque abre o OutboxPanel. Silêncio no caminho feliz:
// sincronizado e enviando ficam neutros; offline (warning) e requer ação (danger) ganham fundo. Sempre ícone + texto.

const LOOK: Record<SyncStatusState, { icon: LucideIcon; iconClass: string; box: string }> = {
  sincronizado: {
    icon: CircleCheck,
    iconClass: "text-success-text",
    box: "border border-border bg-background",
  },
  enviando: {
    icon: RefreshCw,
    iconClass: "text-brand-text",
    box: "border border-border bg-background",
  },
  offline: { icon: CloudOff, iconClass: "text-warning-text", box: "bg-warning-subtle" },
  "requer-acao": { icon: CloudAlert, iconClass: "text-danger-text", box: "bg-danger-subtle" },
};

type SyncStatusProps = {
  state: SyncStatusState;
  label: string;
  /** Só no tamanho completo. */
  detail?: string | null;
  size: "completo" | "compacto";
  onClick?: () => void;
  className?: string;
};

export function SyncStatus({
  state,
  label,
  detail,
  size,
  onClick,
  className = "",
}: SyncStatusProps) {
  const { icon: Icon, iconClass, box } = LOOK[state];
  const showDetail = size === "completo" && detail;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Pendências: ${label}${showDetail ? `, ${detail}` : ""}`}
      data-state={state}
      className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        size === "completo" ? "h-8" : "h-10"
      } ${box} ${className}`}
    >
      <Icon className={`size-4 shrink-0 ${iconClass}`} aria-hidden="true" />
      <span className="text-sm font-medium whitespace-nowrap text-foreground">{label}</span>
      {showDetail ? (
        <span className="text-xs whitespace-nowrap text-muted-foreground">{detail}</span>
      ) : null}
    </button>
  );
}
