import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";
import Link from "next/link";

import { ListRow } from "@/shared/components/list-row";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";

// A lista de /clients (Figma 70:2405 e 70:2564): Table no desktop, ListRow abaixo de `md`. A linha inteira abre
// /clients/edit?id=. O SyncBadge só aparece fora do sincronizado (silêncio no caminho feliz). "Imóveis" conta os
// imóveis do cliente no aparelho.

export interface ClientListItem {
  id: string;
  name: string;
  /** Já com a máscara de exibição. */
  document: string | null;
  email: string | null;
  phone: string | null;
  /** Quantos imóveis do cliente estão no aparelho. */
  properties: number;
  sync: SyncBadgeState;
}

export const clientHref = (id: string) => `/clients/edit?id=${encodeURIComponent(id)}`;

const propertiesLabel = (n: number) => (n === 0 ? undefined : `${n} ${n === 1 ? "imóvel" : "imóveis"}`);

const badgeOf = (item: ClientListItem) =>
  item.sync === "sincronizado" ? null : <SyncBadge state={item.sync} />;

export function ClientsList({ items }: { items: ClientListItem[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-[180px]">CPF ou CNPJ</TableHead>
              <TableHead className="w-[260px]">E-mail</TableHead>
              <TableHead className="w-[160px]">Telefone</TableHead>
              <TableHead className="w-[100px] text-right">Imóveis</TableHead>
              <TableHead className="w-[180px]">Sincronização</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="relative">
                <TableCell className="truncate">
                  {/* O link cobre a linha inteira (::after), e o nome continua sendo o nome acessível. */}
                  <Link
                    href={clientHref(item.id)}
                    className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                  >
                    {item.name}
                  </Link>
                </TableCell>
                <TableCell className="truncate">{item.document}</TableCell>
                <TableCell className="truncate">{item.email}</TableCell>
                <TableCell className="truncate">{item.phone}</TableCell>
                <TableCell className="text-right tabular-nums">{item.properties}</TableCell>
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
              href={clientHref(item.id)}
              title={item.name}
              subtitle={[item.document, item.phone].filter(Boolean).join(" · ") || undefined}
              meta={propertiesLabel(item.properties)}
              trailing={badgeOf(item)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
