import { Badge } from "@sanjou/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";
import Link from "next/link";

import { ListRow } from "@/shared/components/list-row";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";

// A lista de /inspections (wireframe 67:1490): Table no desktop, ListRow abaixo de `md`. A linha inteira abre a tela de
// campo. O SyncBadge só aparece fora do sincronizado (silêncio no caminho feliz). Sem o menu "···": laudo e excluir
// chegam no M5, e a busca e os filtros também.

export interface InspectionListItem {
  id: string;
  href: string;
  /** "Rua das Flores, 120 · ap 32". */
  address: string;
  clientName: string | null;
  /** "Entrada". */
  kindLabel: string | null;
  /** "Em andamento", "Concluída". */
  statusLabel: string | null;
  completed: boolean;
  /** "19/10/2026". */
  startedOn: string;
  /** "Iniciada em 19/10, 09:12". */
  startedMeta: string;
  sync: SyncBadgeState;
}

const statusOf = (item: InspectionListItem) =>
  item.statusLabel ? (
    <Badge variant={item.completed ? "success" : "outline"}>{item.statusLabel}</Badge>
  ) : null;

const badgeOf = (item: InspectionListItem) =>
  item.sync === "sincronizado" ? null : <SyncBadge state={item.sync} />;

export function InspectionsList({ items }: { items: InspectionListItem[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel</TableHead>
              <TableHead className="w-[200px]">Cliente</TableHead>
              <TableHead className="w-[100px]">Tipo</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[120px]">Início</TableHead>
              <TableHead className="w-[180px]">Sincronização</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="relative">
                <TableCell className="truncate">
                  {/* O link cobre a linha inteira (::after), e o endereço continua sendo o nome acessível. */}
                  <Link
                    href={item.href}
                    className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                  >
                    {item.address}
                  </Link>
                </TableCell>
                <TableCell className="truncate">{item.clientName}</TableCell>
                <TableCell className="truncate">{item.kindLabel}</TableCell>
                <TableCell>{statusOf(item)}</TableCell>
                <TableCell className="tabular-nums">{item.startedOn}</TableCell>
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
              href={item.href}
              title={item.address}
              subtitle={[item.clientName, item.kindLabel].filter(Boolean).join(" · ") || undefined}
              meta={item.startedMeta || undefined}
              trailing={
                <>
                  {statusOf(item)}
                  {badgeOf(item)}
                </>
              }
            />
          </li>
        ))}
      </ul>
    </>
  );
}
