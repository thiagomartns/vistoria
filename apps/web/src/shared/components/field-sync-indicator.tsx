import {
  CircleAlert,
  CircleCheck,
  Clock,
  CloudAlert,
  type LucideIcon,
  RefreshCw,
} from "lucide-react";

// Estado de sync de um campo, ao lado do label (Figma FieldSyncIndicator 25:1083): alterado no aparelho e ainda não
// confirmado, enviando, salvo (transitório), em conflito ou recusado pelo servidor. Ícone de 12 px + texto xs; quem usa
// liga o `id` ao campo pelo `aria-describedby`. Específico do vistoria (ADR 0020).

export type FieldSyncState = "local" | "enviando" | "sincronizado" | "conflito" | "rejeitado";

const LOOK: Record<FieldSyncState, { icon: LucideIcon; label: string; color: string }> = {
  local: { icon: Clock, label: "Não enviado", color: "text-muted-foreground" },
  enviando: { icon: RefreshCw, label: "Enviando", color: "text-brand-text" },
  sincronizado: { icon: CircleCheck, label: "Salvo", color: "text-success-text" },
  conflito: { icon: CloudAlert, label: "Em conflito", color: "text-danger-text" },
  rejeitado: { icon: CircleAlert, label: "Revisar", color: "text-danger-text" },
};

export function FieldSyncIndicator({ state, id }: { state: FieldSyncState; id?: string }) {
  const { icon: Icon, label, color } = LOOK[state];
  return (
    <span
      id={id}
      data-state={state}
      className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap ${color}`}
    >
      <Icon
        className={`size-3 shrink-0 ${state === "enviando" ? "motion-safe:animate-spin" : ""}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
