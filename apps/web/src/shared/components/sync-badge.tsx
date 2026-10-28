import {
  CircleAlert,
  CircleCheck,
  Clock,
  CloudAlert,
  type LucideIcon,
  RefreshCw,
  Trash2,
} from "lucide-react";

// Estado de sync de um registro (Figma SyncBadge 25:1053), na linha de lista e no cabeçalho do registro. Os tokens
// do Badge do Sanjou (h-5, px-1.5, gap-1, text-xs medium, rounded-sm) com ícone de 12 px, porque o Badge não aceita
// ícone. Sempre ícone + texto. Na lista, sincronizado não aparece (silêncio no caminho feliz): quem decide é a tela.
// "Excluindo" (nó 139:1821) é a exclusão na fila, até o 204.

export type SyncBadgeState =
  | "local"
  | "enviando"
  | "sincronizado"
  | "conflito"
  | "rejeitado"
  | "excluindo";

const LOOK: Record<SyncBadgeState, { icon: LucideIcon; label: string; box: string }> = {
  local: {
    icon: Clock,
    label: "Salvo no aparelho",
    box: "bg-secondary text-secondary-foreground",
  },
  enviando: { icon: RefreshCw, label: "Enviando", box: "bg-brand-subtle text-brand-text" },
  sincronizado: {
    icon: CircleCheck,
    label: "Sincronizado",
    box: "bg-success-subtle text-success-text",
  },
  conflito: { icon: CloudAlert, label: "Conflito", box: "bg-danger-subtle text-danger-text" },
  rejeitado: {
    icon: CircleAlert,
    label: "Correção necessária",
    box: "bg-danger-subtle text-danger-text",
  },
  excluindo: { icon: Trash2, label: "Excluindo", box: "bg-secondary text-secondary-foreground" },
};

export function SyncBadge({
  state,
  className = "",
}: {
  state: SyncBadgeState;
  className?: string;
}) {
  const { icon: Icon, label, box } = LOOK[state];
  return (
    <span
      data-state={state}
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap ${box} ${className}`}
    >
      <Icon
        className={`size-3 shrink-0 ${state === "enviando" ? "motion-safe:animate-spin" : ""}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
