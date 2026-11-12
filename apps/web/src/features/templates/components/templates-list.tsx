import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";
import Link from "next/link";

import { ListRow } from "@/shared/components/list-row";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";

// A lista de /templates (Figma "Roteiros (#173)", estado 1): Table no desktop, ListRow abaixo de `md`. A linha inteira
// abre /templates/edit?id=. O SyncBadge só aparece fora do sincronizado (silêncio no caminho feliz).

export interface TemplateListItem {
  id: string;
  name: string;
  roomCount: number;
  itemCount: number;
  sync: SyncBadgeState;
}

export const templateHref = (id: string) => `/templates/edit?id=${encodeURIComponent(id)}`;

const badgeOf = (item: TemplateListItem) =>
  item.sync === "sincronizado" ? null : <SyncBadge state={item.sync} />;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function TemplatesList({ items }: { items: TemplateListItem[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-[120px] text-right">Ambientes</TableHead>
              <TableHead className="w-[120px] text-right">Itens</TableHead>
              <TableHead className="w-[180px]">Sincronização</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="relative">
                <TableCell className="truncate">
                  {/* O link cobre a linha inteira (::after), e o nome continua sendo o nome acessível. */}
                  <Link
                    href={templateHref(item.id)}
                    className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                  >
                    {item.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{item.roomCount}</TableCell>
                <TableCell className="text-right tabular-nums">{item.itemCount}</TableCell>
                <TableCell>{badgeOf(item)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col md:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <ListRow
              href={templateHref(item.id)}
              title={item.name}
              subtitle={`${plural(item.roomCount, "ambiente", "ambientes")} · ${plural(item.itemCount, "item", "itens")}`}
              trailing={badgeOf(item)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
