import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";
import Link from "next/link";

import { ListRow } from "@/shared/components/list-row";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";

// A lista de /templates (Figma "Roteiros (#173)", estado 1): Table no desktop, ListRow abaixo de `lg`. A linha inteira
// abre /templates/edit?id=. O SyncBadge só aparece fora do sincronizado (silêncio no caminho feliz).

export interface TemplateListItem {
  id: string;
  name: string;
  roomCount: number;
  itemCount: number;
  sync: SyncBadgeState;
}

export const templateHref = (id: string) => `/templates/edit?id=${encodeURIComponent(id)}`;

// Numa tabela mais estreita que a do frame de 1440 px, as colunas secundárias saem pela largura dela (container
// query), da primeira à última: Itens e Ambientes. Cada limite é a soma das colunas que ficam mais 180 px para o Nome,
// que nunca sai, e o `min-w` da tabela é o mesmo piso com só as colunas que nunca saem (ADR 0061).
const COLUMN = {
  rooms: "w-[120px] text-right hidden @min-[600px]:table-cell",
  items: "w-[120px] text-right hidden @min-[720px]:table-cell",
  sync: "w-[180px]",
};

const badgeOf = (item: TemplateListItem) =>
  item.sync === "sincronizado" ? null : <SyncBadge state={item.sync} />;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function TemplatesList({ items }: { items: TemplateListItem[] }) {
  return (
    <>
      <div className="@container hidden overflow-hidden rounded-lg border border-border lg:block">
        <Table className="min-w-[360px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className={COLUMN.rooms}>Ambientes</TableHead>
              <TableHead className={COLUMN.items}>Itens</TableHead>
              <TableHead className={COLUMN.sync}>Sincronização</TableHead>
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
                <TableCell className={`tabular-nums ${COLUMN.rooms}`}>{item.roomCount}</TableCell>
                <TableCell className={`tabular-nums ${COLUMN.items}`}>{item.itemCount}</TableCell>
                <TableCell>{badgeOf(item)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col lg:hidden">
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
