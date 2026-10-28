"use client";

import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { PropertyForm } from "@/features/properties/components/property-form";
import { PROPERTIES_HREF, usePropertyForm } from "@/features/properties/hooks/usePropertyForm";
import { ConflictNotice } from "@/shared/components/conflict-notice";

import { PageHeader } from "../../shell-header";

// /properties/edit (Figma 71:3087 desktop, 71:3337 celular): a mesma tela para novo (sem `id`, "Novo imóvel") e
// edição. No header, "Voltar", o endereço e o SyncBadge do registro. A seção "Vistorias deste imóvel" chega com a
// vistoria (nota 71:3569). Em conflito, o aviso com "Resolver conflito" acima do formulário (55:5132).

const NEW_CLIENT_HREF = "/clients/edit";

export function PropertyEditScreen() {
  const id = useSearchParams().get("id");
  const { status, title, sync, form, onSubmit, clientOptions, typeOptions, formError, conflict } =
    usePropertyForm(id);

  return (
    <>
      <PageHeader title={title} backHref={PROPERTIES_HREF} sync={sync} />
      {status === "missing" ? (
        <div className="flex flex-col items-start gap-4">
          <Alert variant="warning" role="status">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>Este imóvel não está neste aparelho.</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href={PROPERTIES_HREF}>Voltar para a lista</Link>
          </Button>
        </div>
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
