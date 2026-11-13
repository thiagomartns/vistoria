import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

// Linha do tempo (Figma TimelineItem 231:1825 e Timeline 231:1826): um ponto por registro numa trilha vertical, em
// ordem de data, cada item abrindo o registro. O marcador diz o estado: vazado (aberto), cheio (fechado) ou apagado (o
// registro está saindo, e o texto também se apaga). Título e meta truncam em uma linha; embaixo, o que quem usa
// passar (um SyncBadge); à direita, o ChevronRight. A trilha some acima do primeiro e abaixo do último. Candidato ao
// Sanjou.

export type TimelineMarker = "hollow" | "filled" | "muted";

const MARKER: Record<TimelineMarker, string> = {
  hollow: "border-2 border-foreground bg-background",
  filled: "bg-foreground",
  muted: "bg-border",
};

export function Timeline({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol aria-label={label} className="flex w-full flex-col">
      {children}
    </ol>
  );
}

type TimelineItemProps = {
  href: string;
  title: string;
  meta?: string;
  marker: TimelineMarker;
  /** Embaixo da meta (um SyncBadge). */
  badge?: ReactNode;
};

export function TimelineItem({ href, title, meta, marker, badge }: TimelineItemProps) {
  const muted = marker === "muted";
  return (
    <li className="group" data-marker={marker}>
      <Link
        href={href}
        className="flex w-full gap-3 rounded-md px-2 outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden="true" className="flex w-3 shrink-0 flex-col items-center gap-1">
          <span className="h-3.5 w-px bg-border group-first:invisible" />
          <span className={`size-2.5 shrink-0 rounded-full ${MARKER[marker]}`} />
          <span className="w-px flex-1 bg-border group-last:invisible" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1 py-3">
          <span
            className={`w-full truncate text-base font-medium ${muted ? "text-muted-foreground" : "text-foreground"}`}
          >
            {title}
          </span>
          {meta ? (
            <span
              className={`w-full truncate text-sm text-muted-foreground ${muted ? "opacity-70" : ""}`}
            >
              {meta}
            </span>
          ) : null}
          {badge}
        </span>
        <ChevronRight
          className="size-4 shrink-0 self-center text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
