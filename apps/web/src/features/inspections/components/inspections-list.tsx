import { Badge } from "@sanjou/ui/badge";
import { Button } from "@sanjou/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";
import { Printer } from "lucide-react";
import Link from "next/link";

import { ListRow } from "@/shared/components/list-row";
import { SyncBadge, type SyncBadgeState } from "@/shared/components/sync-badge";

import { DeleteInspection } from "./delete-inspection";

// A lista de /inspections (wireframe 67:1490): Table no desktop, ListRow abaixo de `lg`. A linha inteira abre a tela de
// campo. O SyncBadge só aparece fora do sincronizado (silêncio no caminho feliz). No desktop, a linha em andamento tem
// o "···" com "Excluir vistoria" (#107, estado 4); no celular, exclui-se pela tela de campo. A linha com a exclusão na
// fila fica apagada, com "Excluindo", até o 204 (estado 5). A concluída e confirmada tem o botão "Laudo" no lugar do
// "···" (Figma 177:16524, estado 8); no celular, o laudo abre pela tela de campo. A busca e os filtros (#175) ficam na
// tela: a lista recebe as linhas já filtradas.

export interface InspectionListItem {
  id: string;
  href: string;
  /** Em andamento e ainda não saindo: o "···" aparece. */
  deletable: boolean;
  /** A exclusão está na fila. */
  deleting: boolean;
  /** "Rua das Flores, 120 · ap 32 · Vistoria de entrada", no Dialog. */
  deleteSubject: string;
  /** Há alteração que o servidor ainda não tem (o Dialog avisa que ela é descartada). */
  unsent: boolean;
  /** "Rua das Flores, 120 · ap 32". */
  address: string;
  clientName: string | null;
  /** "Entrada". */
  kindLabel: string | null;
  /** "Em andamento", "Concluída". */
  statusLabel: string | null;
  completed: boolean;
  /** O laudo, só na concluída e confirmada pelo servidor. */
  reportHref: string | null;
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

// Numa tabela mais estreita que a do frame de 1440 px, as colunas secundárias saem pela largura dela (container
// query), da primeira à última: Início, Tipo e Cliente. Cada limite é a soma das colunas que ficam mais 180 px para o
// Imóvel, que nunca sai, como Status, Sincronização e Ações; o `min-w` da tabela é o piso com só essas, e abaixo dele
// a tabela rola dentro da borda (ADR 0061).
const COLUMN = {
  client: "w-[200px] hidden @min-[756px]:table-cell",
  kind: "w-[100px] hidden @min-[856px]:table-cell",
  status: "w-[140px]",
  started: "w-[120px] hidden @min-[976px]:table-cell",
  sync: "w-[180px]",
  actions: "w-[56px]",
};

export function InspectionsList({
  items,
  onDelete,
}: {
  items: InspectionListItem[];
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="@container hidden overflow-hidden rounded-lg border border-border lg:block">
        <Table className="min-w-[556px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel</TableHead>
              <TableHead className={COLUMN.client}>Cliente</TableHead>
              <TableHead className={COLUMN.kind}>Tipo</TableHead>
              <TableHead className={COLUMN.status}>Status</TableHead>
              <TableHead className={COLUMN.started}>Início</TableHead>
              <TableHead className={COLUMN.sync}>Sincronização</TableHead>
              <TableHead className={COLUMN.actions}>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                className={`relative ${item.deleting ? "text-muted-foreground" : ""}`}
              >
                <TableCell className="truncate">
                  {/* O link cobre a linha inteira (::after), e o endereço continua sendo o nome acessível. */}
                  <Link
                    href={item.href}
                    className="outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                  >
                    {item.address}
                  </Link>
                </TableCell>
                <TableCell className={`truncate ${COLUMN.client}`}>{item.clientName}</TableCell>
                <TableCell className={`truncate ${COLUMN.kind}`}>{item.kindLabel}</TableCell>
                <TableCell>{statusOf(item)}</TableCell>
                <TableCell className={`tabular-nums ${COLUMN.started}`}>{item.startedOn}</TableCell>
                <TableCell>{badgeOf(item)}</TableCell>
                <TableCell className="py-0 text-right">
                  {/* Acima do link que cobre a linha, para o "···" receber o clique. */}
                  {item.deletable ? (
                    <DeleteInspection
                      subject={item.deleteSubject}
                      pending={item.unsent}
                      onConfirm={() => onDelete(item.id)}
                      className="relative z-10"
                    />
                  ) : item.reportHref ? (
                    <Button asChild variant="ghost" size="icon" className="relative z-10">
                      <Link href={item.reportHref} aria-label={`Laudo de ${item.address}`}>
                        <Printer aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col lg:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <ListRow
              href={item.href}
              title={item.address}
              subtitle={[item.clientName, item.kindLabel].filter(Boolean).join(" · ") || undefined}
              meta={item.startedMeta || undefined}
              muted={item.deleting}
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
