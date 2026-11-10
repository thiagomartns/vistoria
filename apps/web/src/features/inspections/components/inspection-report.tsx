import { Separator } from "@sanjou/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@sanjou/ui/table";

import { AvisLockup } from "@/shared/components/avis-lockup";

import type { InspectionReport, ReportItem } from "../models/inspection-report";

/** O rodapé fixo da folha, como no frame. */
export const REPORT_FOOTNOTE =
  "Documento gerado pelo Avis a partir da vistoria concluída, que não pode mais ser alterada. A identificação e a versão permitem conferir o registro no servidor.";

// A folha do laudo (Figma 177:16524, estados 1 a 3): na tela, os ambientes em sequência; na impressão, sem borda nem
// fundo, cada ambiente a partir do segundo começa numa página e nenhum item é cortado entre páginas (o `@page` do
// globals.css põe a margem A4 e a paginação). No celular, a observação sai da tabela e fica abaixo dela; a impressão
// usa sempre o layout do desktop.
export function InspectionReportSheet({ report }: { report: InspectionReport }) {
  const moveOut = report.kind === "moveOut";
  return (
    <article
      aria-label={report.title}
      className="mx-auto flex w-full max-w-[754px] flex-col gap-5 rounded-lg border border-border bg-background p-4 md:p-12 print:max-w-none print:rounded-none print:border-0 print:p-0"
    >
      <AvisLockup layout="horizontal" className="self-start" />
      <h2 className="text-lg font-semibold text-foreground">{report.title}</h2>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-sm md:grid-cols-[132px_1fr] print:grid-cols-[132px_1fr]">
        {report.fields.map((field) => (
          <div key={field.label} className="contents">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>
      <Separator />
      {report.rooms.map((room, index) => (
        <section
          key={room.id}
          aria-labelledby={`ambiente-${room.id}`}
          className={`flex flex-col gap-2 ${index > 0 ? "print:break-before-page" : ""}`}
        >
          <h3 id={`ambiente-${room.id}`} className="text-base font-semibold text-foreground">
            {room.title}
          </h3>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  {moveOut ? <TableHead className="w-[30%]">Entrada</TableHead> : null}
                  <TableHead className="w-[18%]">{moveOut ? "Saída" : "Condição"}</TableHead>
                  <TableHead className="hidden w-[36%] md:table-cell print:table-cell">
                    Observação
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {room.items.map((item) => (
                  <TableRow key={item.id} className="break-inside-avoid hover:bg-transparent">
                    <TableCell className="py-2 whitespace-normal">{item.name}</TableCell>
                    {moveOut ? (
                      <TableCell className="py-2 whitespace-normal">
                        {item.reference ? (
                          <>
                            {item.reference.condition}
                            {item.reference.notes ? (
                              <span className="hidden md:inline print:inline">
                                {" · "}
                                {item.reference.notes}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="py-2 whitespace-normal">{item.condition}</TableCell>
                    <TableCell className="hidden py-2 whitespace-normal md:table-cell print:table-cell">
                      {item.notes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <NotesBelow items={room.items} moveOut={moveOut} />
        </section>
      ))}
      {report.generalNotes ? (
        <section aria-labelledby="observacoes-gerais" className="flex flex-col gap-1.5">
          <h3 id="observacoes-gerais" className="text-base font-semibold text-foreground">
            Observações gerais
          </h3>
          <p className="text-sm whitespace-pre-line text-foreground">{report.generalNotes}</p>
        </section>
      ) : null}
      <Separator />
      <p className="text-xs text-muted-foreground">{REPORT_FOOTNOTE}</p>
    </article>
  );
}

/** "Paredes: Furo de bucha" (entrada) ou "Paredes · Entrada: … · Saída: …" (saída): só no celular e com observação. */
function noteOf(item: ReportItem, moveOut: boolean): string | null {
  if (!moveOut) return item.notes ? `${item.name}: ${item.notes}` : null;
  const parts = [
    item.reference?.notes && `Entrada: ${item.reference.notes}`,
    item.notes && `Saída: ${item.notes}`,
  ].filter(Boolean);
  return parts.length > 0 ? [item.name, ...parts].join(" · ") : null;
}

function NotesBelow({ items, moveOut }: { items: readonly ReportItem[]; moveOut: boolean }) {
  const notes = items
    .map((item) => ({ id: item.id, text: noteOf(item, moveOut) }))
    .filter((note) => note.text);
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground md:hidden print:hidden">
      {notes.map((note) => (
        <li key={note.id}>{note.text}</li>
      ))}
    </ul>
  );
}
