"use client";

import { Button } from "@sanjou/ui/button";
import { Printer } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { CompleteInspection } from "@/features/inspections/components/complete-inspection";
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
// ambiente, Próximo vira "Concluir vistoria" (Figma 164:12824): o que falta marca os chips e abre o ambiente do primeiro;
// sem nada faltando, o Dialog confirma, e a conclusão vai para a fila. Concluída, só leitura e sem o "···". Em
// andamento, o "···" do header exclui a vistoria (#107): confirmada, a exclusão vai para a fila e a tela volta para a
// lista; aberta com a exclusão na fila, fica só leitura. Concluída e confirmada, "Ver laudo" no header (#168).
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
          ) : field.reportHref ? (
            // Figma 177:16524, estado 7: "Ver laudo" no desktop; no celular, só o ícone.
            <Button
              asChild
              variant="outline"
              size="sm"
              className="max-md:size-8 max-md:border-transparent max-md:px-0"
            >
              <Link href={field.reportHref} aria-label="Ver laudo">
                <Printer aria-hidden="true" />
                <span className="hidden md:inline">Ver laudo</span>
              </Link>
            </Button>
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
        finish={field.finish}
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
          completion={field.completion}
        />
      </StepperForm>
      <CompleteInspection
        open={field.confirming}
        onOpenChange={field.setConfirming}
        subject={field.deleteSubject}
        pending={field.unsent}
        onConfirm={field.complete}
      />
    </>
  );
}
