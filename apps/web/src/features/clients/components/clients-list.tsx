import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";
import Link from "next/link";

import { ListRow } from "@/shared/components/list-row";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";

// A lista de /clients (Figma 70:2405 e 70:2564): Table no desktop, ListRow abaixo de `lg`. A linha inteira abre
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

// Numa tabela mais estreita que a do frame de 1440 px, as colunas secundárias saem pela largura dela (container
// query), da primeira à última: E-mail, CPF ou CNPJ e Telefone. Cada limite é a soma das colunas que ficam mais
// 180 px para o Nome, que nunca sai; o `min-w` da tabela é o mesmo piso, com só as colunas que nunca saem (ADR 0061).
const COLUMN = {
  document: "w-[180px] hidden @min-[800px]:table-cell",
  email: "w-[260px] hidden @min-[1060px]:table-cell",
  phone: "w-[160px] hidden @min-[620px]:table-cell",
  properties: "w-[100px] text-right",
  sync: "w-[180px]",
};

const badgeOf = (item: ClientListItem) =>
  item.sync === "sincronizado" ? null : <SyncBadge state={item.sync} />;

export function ClientsList({ items }: { items: ClientListItem[] }) {
  return (
    <>
      <div className="@container hidden overflow-hidden rounded-lg border border-border lg:block">
        <Table className="min-w-[460px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className={COLUMN.document}>CPF ou CNPJ</TableHead>
              <TableHead className={COLUMN.email}>E-mail</TableHead>
              <TableHead className={COLUMN.phone}>Telefone</TableHead>
              <TableHead className={COLUMN.properties}>Imóveis</TableHead>
              <TableHead className={COLUMN.sync}>Sincronização</TableHead>
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
                <TableCell className={`truncate ${COLUMN.document}`}>{item.document}</TableCell>
                <TableCell className={`truncate ${COLUMN.email}`}>{item.email}</TableCell>
                <TableCell className={`truncate ${COLUMN.phone}`}>{item.phone}</TableCell>
                <TableCell className={`tabular-nums ${COLUMN.properties}`}>{item.properties}</TableCell>
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
