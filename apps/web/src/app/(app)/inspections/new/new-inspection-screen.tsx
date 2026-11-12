"use client";

import { NewInspectionForm } from "@/features/inspections/components/new-inspection-form";
import { INSPECTIONS_HREF } from "@/features/inspections/hooks/useInspections";
import { useNewInspection } from "@/features/inspections/hooks/useNewInspection";

import { PageHeader } from "../../shell-header";

// /inspections/new (wireframes 68:1644 e 68:1878, e a seção "Nova vistoria · roteiro (#174)"): escolhe o imóvel e o
// tipo e começa a vistoria, mesmo offline: a entrada pelo roteiro escolhido (ou pelo padrão, sem roteiro no aparelho), a saída a partir de uma entrada concluída do imóvel. "Começar vistoria" abre a tela de
// campo no primeiro ambiente.

export function NewInspectionScreen() {
  const {
    ready,
    form,
    onSubmit,
    propertyOptions,
    templateOptions,
    templateId,
    defaultTemplate,
    moveOut,
    moveInOptions,
    moveInId,
    noMoveIn,
    waitingMoveIn,
  } = useNewInspection();

  return (
    <>
      <PageHeader title="Nova vistoria" backHref={INSPECTIONS_HREF} />
      {ready ? (
        <NewInspectionForm
          form={form}
          onSubmit={onSubmit}
          propertyOptions={propertyOptions}
          templateOptions={templateOptions}
          templateId={templateId}
          defaultTemplate={defaultTemplate}
          templatesHref="/templates"
          moveOut={moveOut}
          moveInOptions={moveInOptions}
          moveInId={moveInId}
          noMoveIn={noMoveIn}
          waitingMoveIn={waitingMoveIn}
          newPropertyHref="/properties/edit"
          propertiesHref="/properties"
          cancelHref={INSPECTIONS_HREF}
        />
      ) : null}
    </>
  );
}
