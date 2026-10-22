"use client";

import { Alert, AlertDescription } from "@sanjou/ui/alert";
import { Button } from "@sanjou/ui/button";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ClientForm } from "@/features/clients/components/client-form";
import { CLIENTS_HREF, useClientForm } from "@/features/clients/hooks/useClientForm";

import { PageHeader } from "../../shell-header";

// /clients/edit (Figma 70:2719 desktop, 70:2862 celular): a mesma tela para novo (sem `id`) e edição. No header,
// "Voltar", o nome e o SyncBadge do registro (nota 70:2993).

export function ClientEditScreen() {
  const id = useSearchParams().get("id");
  const { status, title, sync, form, onSubmit, formError } = useClientForm(id);

  return (
    <>
      <PageHeader title={title} backHref={CLIENTS_HREF} sync={sync} />
      {status === "missing" ? (
        <div className="flex flex-col items-start gap-4">
          <Alert variant="warning" role="status">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>Este cliente não está neste aparelho.</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href={CLIENTS_HREF}>Voltar para a lista</Link>
          </Button>
        </div>
      ) : status === "loading" ? null : (
        <ClientForm form={form} onSubmit={onSubmit} error={formError} cancelHref={CLIENTS_HREF} />
      )}
    </>
  );
}
