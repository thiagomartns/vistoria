"use client";

import { useSearchParams } from "next/navigation";

import { ClientForm } from "@/features/clients/components/client-form";
import { CLIENTS_HREF, useClientForm } from "@/features/clients/hooks/useClientForm";
import { SaveWithInspectionsDialog } from "@/features/inspections/components/save-with-inspections-dialog";
import { ConflictNotice } from "@/shared/components/conflict-notice";
import { RecordUnavailable } from "@/shared/components/record-unavailable";

import { PageHeader } from "../../shell-header";

// /clients/edit (Figma 70:2719 desktop, 70:2862 celular): a mesma tela para novo (sem `id`) e edição. No header,
// "Voltar", o nome e o SyncBadge do registro (nota 70:2993). Em conflito, o aviso com "Resolver conflito" acima do
// formulário, como o estado 5 da tela de campo (55:5132). Um id que o aparelho não tem é buscado no servidor (#101); sem
// rede, não encontrado ou com falha, o aviso toma o lugar do formulário. Mudar o nome ou o documento de um cliente com
// vistorias pede o aviso antes de salvar (Figma "Salvar com vistorias (#234)").

export function ClientEditScreen() {
  const id = useSearchParams().get("id");
  const {
    status,
    unavailable,
    title,
    sync,
    form,
    onSubmit,
    masks,
    formError,
    conflict,
    saveNotice,
  } = useClientForm(id);

  return (
    <>
      <PageHeader title={title} backHref={CLIENTS_HREF} sync={sync} />
      {unavailable ? (
        <RecordUnavailable {...unavailable} backHref={CLIENTS_HREF} />
      ) : status === "loading" ? null : (
        <div className="flex flex-col gap-5">
          {conflict ? <ConflictNotice {...conflict} className="md:max-w-[560px]" /> : null}
          <ClientForm
            form={form}
            onSubmit={onSubmit}
            masks={masks}
            error={formError}
            cancelHref={CLIENTS_HREF}
          />
        </div>
      )}
      <SaveWithInspectionsDialog {...saveNotice} />
    </>
  );
}
