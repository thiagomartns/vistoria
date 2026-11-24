"use client";

import { useSearchParams } from "next/navigation";

import { ConfirmStart } from "@/features/inspections/components/confirm-start";
import { NewInspectionForm } from "@/features/inspections/components/new-inspection-form";
import { INSPECTIONS_HREF } from "@/features/inspections/hooks/useInspections";
import { useNewInspection } from "@/features/inspections/hooks/useNewInspection";

import { PageHeader } from "../../shell-header";

// /inspections/new (wireframes 68:1644 e 68:1878, e a seção "Nova vistoria · roteiro (#174)"): escolhe o imóvel e o
// tipo e começa a vistoria, mesmo offline: a entrada pelo roteiro escolhido (ou pelo padrão, sem roteiro no aparelho;
// num imóvel com entrada em andamento, o aviso e a confirmação, #235), a saída a partir de uma entrada concluída do
// imóvel (a que já tem saída pede confirmação, #184). "Começar vistoria"
// abre a tela de campo no primeiro ambiente. Com `?propertyId=` (o "Nova vistoria" do histórico do imóvel, #176), o
// imóvel já vem escolhido.

export function NewInspectionScreen() {
  const {
    ready,
    form,
    onSubmit,
    propertyOptions,
    propertyLabel,
    noProperties,
    templateOptions,
    templateId,
    defaultTemplate,
    moveOut,
    moveInOptions,
    moveInId,
    chosenHasMoveOut,
    noMoveIn,
    waitingMoveIn,
    openMoveIn,
    confirmStart,
  } = useNewInspection(useSearchParams().get("propertyId"));

  return (
    <>
      <PageHeader title="Nova vistoria" backHref={INSPECTIONS_HREF} />
      {ready ? (
        <NewInspectionForm
          form={form}
          onSubmit={onSubmit}
          propertyOptions={propertyOptions}
          propertyLabel={propertyLabel}
          noProperties={noProperties}
          templateOptions={templateOptions}
          templateId={templateId}
          defaultTemplate={defaultTemplate}
          templatesHref="/templates"
          openMoveIn={openMoveIn}
          moveOut={moveOut}
          moveInOptions={moveInOptions}
          moveInId={moveInId}
          chosenHasMoveOut={chosenHasMoveOut}
          noMoveIn={noMoveIn}
          waitingMoveIn={waitingMoveIn}
          newPropertyHref="/properties/edit"
          propertiesHref="/properties"
          cancelHref={INSPECTIONS_HREF}
        />
      ) : null}
      <ConfirmStart {...confirmStart} />
    </>
  );
}
