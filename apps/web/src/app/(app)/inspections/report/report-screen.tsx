"use client";

import { Alert, AlertDescription, AlertTitle } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Info, Printer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { InspectionReportSheet } from "@/features/inspections/components/inspection-report";
import { useInspectionReport } from "@/features/inspections/hooks/useInspectionReport";
import {
  BACK_PARAM,
  INSPECTIONS_HREF,
  backHrefOf,
  inspectionHref,
} from "@/features/inspections/hooks/useInspections";

import { PageHeader } from "../../shell-header";

// /inspections/report?id= (Figma 177:16524): o laudo da vistoria concluída, lido do banco local (abre offline). Na
// tela, a folha sobre o fundo, com "Imprimir ou salvar PDF" (window.print); na impressão, só a folha (estado 3). Em
// andamento, com a conclusão na fila ou desconhecida, o aviso no lugar do laudo (estados 4 a 6), com o caminho de
// volta. O "Voltar" vai para o `?voltar=`, se ele for um caminho do app, como o histórico do imóvel (#176).
export function ReportScreen() {
  const params = useSearchParams();
  const id = params.get("id");
  const back = backHrefOf(params.get(BACK_PARAM));
  const { ready, view } = useInspectionReport(id);

  return (
    <>
      <PageHeader title="Laudo" backHref={back} />
      {!ready ? null : (
        <div className="flex flex-col gap-4 md:-m-6 md:flex-1 md:bg-muted md:p-6 print:m-0 print:bg-transparent print:p-0">
          {view.state === "report" ? (
            <>
              <div className="mx-auto flex w-full max-w-[754px] justify-end print:hidden">
                <Button type="button" className="w-full md:w-auto" onClick={() => window.print()}>
                  <Printer aria-hidden="true" />
                  Imprimir ou salvar PDF
                </Button>
              </div>
              <InspectionReportSheet report={view.report} />
            </>
          ) : (
            <div className="mx-auto flex w-full max-w-[754px] flex-col items-start gap-4">
              <Alert variant={view.notice.tone} role="status">
                <Info aria-hidden="true" />
                <AlertTitle>{view.notice.title}</AlertTitle>
                <AlertDescription>{view.notice.description}</AlertDescription>
              </Alert>
              {view.state === "inProgress" && id ? (
                <Button asChild className="w-full md:w-auto">
                  <Link href={inspectionHref(id)}>Abrir a vistoria</Link>
                </Button>
              ) : view.state === "notFound" ? (
                <Button asChild className="w-full md:w-auto">
                  <Link href={INSPECTIONS_HREF}>Ver as vistorias</Link>
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </>
  );
}
