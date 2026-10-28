"use client";

import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RoomStep } from "@/features/inspections/components/room-step";
import { INSPECTIONS_HREF } from "@/features/inspections/hooks/useInspections";
import { useInspectionDraft } from "@/features/inspections/hooks/useInspectionDraft";
import { StepperForm } from "@/shared/components/stepper-form";

import { PageHeader } from "../../shell-header";

// /inspections/edit?id= (Figma 43:1748, estados 0, 2, 3, 4, 5 e 6): a tela de campo, um passo por ambiente, com a
// condição em chips e a observação sob demanda. No celular, modo foco: sem a barra inferior, com "Voltar" no header e
// Anterior/Próximo no rodapé. Editável com transação na fila; só leitura com o envio no ar (ADR 0021). No último
// ambiente, Próximo fica desabilitado: concluir chega no M5.

export function InspectionEditScreen() {
  const id = useSearchParams().get("id");
  const field = useInspectionDraft(id);

  if (field.status === "missing") {
    return (
      <>
        <PageHeader title="Vistoria" backHref={INSPECTIONS_HREF} />
        <div className="flex flex-col items-start gap-4">
          <Alert variant="warning" role="status">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>Esta vistoria não está neste aparelho.</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href={INSPECTIONS_HREF}>Voltar para a lista</Link>
          </Button>
        </div>
      </>
    );
  }

  if (field.status === "loading" || !field.header || !field.room) {
    return <PageHeader title="Vistoria" backHref={INSPECTIONS_HREF} focus />;
  }

  const { header, room } = field;
  return (
    <>
      <PageHeader
        title={header.title}
        subtitle={header.subtitle}
        compactSubtitle={header.compactSubtitle}
        sync={header.sync}
        backHref={INSPECTIONS_HREF}
        focus
      />
      <StepperForm
        title="Ambientes"
        summary={field.summary}
        steps={field.rooms.map((view) => ({
          id: view.id,
          label: view.name,
          state: view.state,
          meta: view.meta,
        }))}
        current={field.step}
        onStepChange={field.goTo}
        position={field.position}
      >
        <RoomStep
          key={room.id}
          form={field.form}
          conditions={field.conditions}
          notesMax={field.notesMax}
          roomIndex={field.step}
          name={room.name}
          progress={room.progress}
          items={field.items}
          readOnly={field.readOnly}
          rejection={field.rejection}
          conflict={field.conflict}
        />
      </StepperForm>
    </>
  );
}
