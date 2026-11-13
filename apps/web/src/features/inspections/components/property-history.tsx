import { Button } from "@sanjou/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@sanjou/ui/card";
import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/shared/components/empty-state";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";
import { Timeline, TimelineItem, type TimelineMarker } from "@/shared/components/timeline";

// O histórico do imóvel (Figma "Imóvel · vistorias (#176)"): as vistorias dele numa linha do tempo, da mais nova para
// a mais antiga. A partir de 1280 px, num Card ao lado do formulário, com "Nova vistoria" no rodapé (estado 1,
// desktop); abaixo, na aba Vistorias, com a contagem e "+ Nova vistoria" no topo (estado 1, celular). Sem vistorias,
// o EmptyState (estado 2). O SyncBadge só aparece fora do sincronizado.

export interface HistoryItem {
  id: string;
  href: string;
  title: string;
  meta: string;
  marker: TimelineMarker;
  sync: SyncBadgeState | null;
}

type PropertyHistoryProps = {
  layout: "card" | "tab";
  items: HistoryItem[];
  /** "3 vistorias". */
  count: string;
  newHref: string;
};

const TITLE = "Histórico do imóvel";
const EMPTY_TITLE = "Nenhuma vistoria deste imóvel";
const EMPTY_DESCRIPTION = "A primeira vistoria aparece aqui, e as seguintes logo acima dela.";

function HistoryTimeline({ items }: { items: HistoryItem[] }) {
  return (
    <Timeline label={TITLE}>
      {items.map((item) => (
        <TimelineItem
          key={item.id}
          href={item.href}
          title={item.title}
          meta={item.meta}
          marker={item.marker}
          badge={item.sync ? <SyncBadge state={item.sync} /> : undefined}
        />
      ))}
    </Timeline>
  );
}

export function PropertyHistory({ layout, items, count, newHref }: PropertyHistoryProps) {
  const empty = items.length === 0;
  if (layout === "card") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{TITLE}</CardTitle>
          <CardDescription>{count}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          {empty ? (
            <EmptyState icon={ClipboardList} title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} />
          ) : (
            <HistoryTimeline items={items} />
          )}
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href={newHref}>Nova vistoria</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }
  if (empty) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={EMPTY_TITLE}
        description={EMPTY_DESCRIPTION}
        action={
          <Button asChild>
            <Link href={newHref}>
              <Plus aria-hidden="true" />
              Nova vistoria
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <section aria-label={TITLE} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{count}</h2>
        <Button asChild variant="outline">
          <Link href={newHref}>
            <Plus aria-hidden="true" />
            Nova vistoria
          </Link>
        </Button>
      </div>
      <HistoryTimeline items={items} />
    </section>
  );
}
