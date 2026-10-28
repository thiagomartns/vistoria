"use client";

import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { Info } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useInspectionConflict } from "@/features/inspections/hooks/useInspectionConflict";
import { INSPECTIONS_HREF, inspectionHref } from "@/features/inspections/hooks/useInspections";
import { ConflictResolver } from "@/shared/components/conflict-resolver";

import { PageHeader } from "../../shell-header";

// /inspections/conflict?id= (wireframe 69:2632, ConflictResolver 32:1787 tipo edição): só o que os dois lados mudaram,
// por ambiente e item. Enviar a resolução, ou "Voltar", volta para onde a pessoa estava (nota 69:2635); aberta direto,
// sem histórico, vai para a tela de campo. Os tipos "excluído" e "exclusão alterada" chegam na #109.

export const NO_CONFLICT = "Esta vistoria não tem conflito para resolver.";

export function ConflictScreen() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const conflict = useInspectionConflict(id);
  const fieldHref = id ? inspectionHref(id) : INSPECTIONS_HREF;

  function leave() {
    if (window.history.length > 1) router.back();
    else router.replace(fieldHref);
  }

  if (conflict.status === "none") {
    const href = conflict.known ? fieldHref : INSPECTIONS_HREF;
    return (
      <>
        <PageHeader title="Conflito" backHref={href} />
        <div className="flex flex-col items-start gap-4">
          <Alert role="status">
            <Info aria-hidden="true" />
            <AlertDescription>{NO_CONFLICT}</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href={href}>{conflict.known ? "Abrir a vistoria" : "Voltar para a lista"}</Link>
          </Button>
        </div>
      </>
    );
  }

  if (conflict.status !== "found") return <PageHeader title="Conflito" backHref={fieldHref} />;

  return (
    <>
      <PageHeader title="Conflito" backHref={fieldHref} />
      <ConflictResolver
        description={conflict.description}
        mineOrigin={conflict.mineOrigin}
        theirsOrigin={conflict.theirsOrigin}
        groups={conflict.groups}
        summary={conflict.summary}
        remaining={conflict.remaining}
        canSubmit={conflict.canSubmit}
        submitting={conflict.submitting}
        onChoose={conflict.choose}
        onChooseAll={conflict.chooseAll}
        onSubmit={async () => {
          if (await conflict.submit()) leave();
        }}
        onBack={leave}
      />
    </>
  );
}
