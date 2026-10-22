import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";
import Link from "next/link";

import { ListRow } from "@/shared/components/list-row";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";

// A lista de /properties (Figma 71:2726 e 71:2900): Table no desktop, ListRow abaixo de `md`. A linha inteira abre
// /properties/edit?id=. O SyncBadge só aparece fora do sincronizado (silêncio no caminho feliz). A coluna e a meta
// "Vistorias" chegam com a vistoria.

export interface PropertyListItem {
  id: string;
  /** "Rua das Flores, 120 · ap 32". */
  address: string;
  clientName: string | null;
  typeLabel: string | null;
  /** "São Paulo/SP". */
  place: string;
  sync: SyncBadgeState;
}

export const propertyHref = (id: string) => `/properties/edit?id=${encodeURIComponent(id)}`;

const badgeOf = (item: PropertyListItem) =>
  item.sync === "sincronizado" ? null : <SyncBadge state={item.sync} />;

export function PropertiesList({ items }: { items: PropertyListItem[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Endereço</TableHead>
              <TableHead className="w-[240px]">Cliente</TableHead>
              <TableHead className="w-[140px]">Tipo</TableHead>
              <TableHead className="w-[160px]">Cidade</TableHead>
              <TableHead className="w-[180px]">Sincronização</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="relative">
                <TableCell className="truncate">
                  {/* O link cobre a linha inteira (::after), e o endereço continua sendo o nome acessível. */}
                  <Link
                    href={propertyHref(item.id)}
                    className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                  >
                    {item.address}
                  </Link>
                </TableCell>
                <TableCell className="truncate">{item.clientName}</TableCell>
                <TableCell className="truncate">{item.typeLabel}</TableCell>
                <TableCell className="truncate">{item.place}</TableCell>
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
              href={propertyHref(item.id)}
              title={item.address}
              subtitle={[item.clientName, item.typeLabel].filter(Boolean).join(" · ") || undefined}
              meta={item.place || undefined}
              trailing={badgeOf(item)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
