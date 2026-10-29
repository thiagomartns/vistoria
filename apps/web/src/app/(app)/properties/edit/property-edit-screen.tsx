"use client";

import { useSearchParams } from "next/navigation";

import { PropertyForm } from "@/features/properties/components/property-form";
import { PROPERTIES_HREF, usePropertyForm } from "@/features/properties/hooks/usePropertyForm";
import { ConflictNotice } from "@/shared/components/conflict-notice";
import { RecordUnavailable } from "@/shared/components/record-unavailable";

import { PageHeader } from "../../shell-header";

// /properties/edit (Figma 71:3087 desktop, 71:3337 celular): a mesma tela para novo (sem `id`, "Novo imóvel") e
// edição. No header, "Voltar", o endereço e o SyncBadge do registro. A seção "Vistorias deste imóvel" chega com a
// vistoria (nota 71:3569). Em conflito, o aviso com "Resolver conflito" acima do formulário (55:5132). Um id que o
// aparelho não tem é buscado no servidor, com o cliente (#101); sem rede, não encontrado ou com falha, o aviso toma o
// lugar do formulário.

const NEW_CLIENT_HREF = "/clients/edit";

export function PropertyEditScreen() {
  const id = useSearchParams().get("id");
  const {
    status,
    unavailable,
    title,
    sync,
    form,
    onSubmit,
    clientOptions,
    typeOptions,
    formError,
    conflict,
  } = usePropertyForm(id);

  return (
    <>
      <PageHeader title={title} backHref={PROPERTIES_HREF} sync={sync} />
      {unavailable ? (
        <RecordUnavailable {...unavailable} backHref={PROPERTIES_HREF} />
      ) : status === "loading" ? null : (
        <div className="flex flex-col gap-5">
          {conflict ? <ConflictNotice {...conflict} className="md:max-w-[720px]" /> : null}
          <PropertyForm
            form={form}
            onSubmit={onSubmit}
            clientOptions={clientOptions}
            typeOptions={typeOptions}
            newClientHref={NEW_CLIENT_HREF}
            error={formError}
            cancelHref={PROPERTIES_HREF}
          />
        </div>
      )}
    </>
  );
}
