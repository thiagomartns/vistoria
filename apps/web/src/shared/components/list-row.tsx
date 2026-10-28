import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

// Linha de lista no celular (Figma ListRow 64:1706): abaixo de `md` a Table vira lista. O toque na linha inteira abre
// o registro; altura mínima de 64. Título, subtítulo e meta truncam em uma linha; à direita, o Badge de status e o
// SyncBadge (quem usa decide o que aparece) e o ChevronRight. Candidato ao Sanjou.

type ListRowProps = {
  href: string;
  title: string;
  subtitle?: string;
  meta?: string;
  /** Badges à direita (status, SyncBadge). */
  trailing?: ReactNode;
  /** O registro está saindo (uma exclusão pendente): o título fica apagado. */
  muted?: boolean;
};

export function ListRow({ href, title, subtitle, meta, trailing, muted }: ListRowProps) {
  return (
    <Link
      href={href}
      className="flex min-h-16 w-full items-center gap-3 border-b border-border bg-background px-4 py-3 outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`truncate text-base font-medium ${muted ? "text-muted-foreground" : "text-foreground"}`}
        >
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
        ) : null}
        {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 flex-col items-end gap-1">{trailing}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
