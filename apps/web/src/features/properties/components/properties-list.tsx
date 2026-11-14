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

// Numa tabela mais estreita que a do frame de 1440 px, as colunas secundárias saem pela largura dela (container
// query), da primeira à última: Tipo, Cidade e Cliente. Cada limite é a soma das colunas que ficam mais 180 px para o
// Endereço, que nunca sai; o `min-w` da tabela é o mesmo piso, com só as colunas que nunca saem (ADR 0061).
const COLUMN = {
  client: "w-[240px] hidden @min-[600px]:table-cell",
  type: "w-[140px] hidden @min-[900px]:table-cell",
  place: "w-[160px] hidden @min-[760px]:table-cell",
  sync: "w-[180px]",
};

const badgeOf = (item: PropertyListItem) =>
  item.sync === "sincronizado" ? null : <SyncBadge state={item.sync} />;

export function PropertiesList({ items }: { items: PropertyListItem[] }) {
  return (
    <>
      <div className="@container hidden overflow-hidden rounded-lg border border-border md:block">
        <Table className="min-w-[360px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Endereço</TableHead>
              <TableHead className={COLUMN.client}>Cliente</TableHead>
              <TableHead className={COLUMN.type}>Tipo</TableHead>
              <TableHead className={COLUMN.place}>Cidade</TableHead>
              <TableHead className={COLUMN.sync}>Sincronização</TableHead>
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
                <TableCell className={`truncate ${COLUMN.client}`}>{item.clientName}</TableCell>
                <TableCell className={`truncate ${COLUMN.type}`}>{item.typeLabel}</TableCell>
                <TableCell className={`truncate ${COLUMN.place}`}>{item.place}</TableCell>
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
