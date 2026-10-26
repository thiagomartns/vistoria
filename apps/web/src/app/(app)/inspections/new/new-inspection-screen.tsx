"use client";

import { NewInspectionForm } from "@/features/inspections/components/new-inspection-form";
import { INSPECTIONS_HREF } from "@/features/inspections/hooks/useInspections";
import { useNewInspection } from "@/features/inspections/hooks/useNewInspection";

import { PageHeader } from "../../shell-header";

// /inspections/new (wireframe 68:1644): escolhe o imóvel e começa a vistoria de entrada pelo roteiro padrão, mesmo
// offline; "Começar vistoria" abre a tela de campo no primeiro ambiente.

export function NewInspectionScreen() {
  const { ready, form, onSubmit, propertyOptions, templateLabel } = useNewInspection();

  return (
    <>
      <PageHeader title="Nova vistoria" backHref={INSPECTIONS_HREF} />
      {ready ? (
        <NewInspectionForm
          form={form}
          onSubmit={onSubmit}
          propertyOptions={propertyOptions}
          templateLabel={templateLabel}
          newPropertyHref="/properties/edit"
          propertiesHref="/properties"
          cancelHref={INSPECTIONS_HREF}
        />
      ) : null}
    </>
  );
}
