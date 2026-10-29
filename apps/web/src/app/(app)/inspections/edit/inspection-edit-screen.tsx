"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { DeleteInspection } from "@/features/inspections/components/delete-inspection";
import { RoomStep } from "@/features/inspections/components/room-step";
import { INSPECTIONS_HREF } from "@/features/inspections/hooks/useInspections";
import { useInspectionDraft } from "@/features/inspections/hooks/useInspectionDraft";
import { RecordUnavailable } from "@/shared/components/record-unavailable";
import { StepperForm } from "@/shared/components/stepper-form";

import { PageHeader } from "../../shell-header";

// /inspections/edit?id= (Figma 43:1748, estados 0, 2, 3, 4, 5 e 6): a tela de campo, um passo por ambiente, com a
// condição em chips e a observação sob demanda. No celular, modo foco: sem a barra inferior, com "Voltar" no header e
// Anterior/Próximo no rodapé. Editável com transação na fila; só leitura com o envio no ar (ADR 0021). No último
// ambiente, Próximo fica desabilitado: concluir chega no M5. Em andamento, o "···" do header exclui a vistoria (#107):
// confirmada, a exclusão vai para a fila e a tela volta para a lista; aberta com a exclusão na fila, fica só leitura.
// Uma vistoria que o aparelho não tem é buscada no servidor, com o imóvel e o cliente (#101).

export function InspectionEditScreen() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const field = useInspectionDraft(id);

  if (field.unavailable) {
    return (
      <>
        <PageHeader title="Vistoria" backHref={INSPECTIONS_HREF} />
        <RecordUnavailable {...field.unavailable} backHref={INSPECTIONS_HREF} />
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
        actions={
          field.deletable ? (
            <DeleteInspection
              subject={field.deleteSubject}
              pending={field.unsent}
              onConfirm={async () => {
                await field.remove();
                router.push(INSPECTIONS_HREF);
              }}
            />
          ) : null
        }
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
          deletion={field.deletion}
        />
      </StepperForm>
    </>
  );
}
