"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@sanjou/ui/tabs";
import { useRouter, useSearchParams } from "next/navigation";

import { PropertyHistory } from "@/features/inspections/components/property-history";
import {
  propertyHistoryHref,
  usePropertyHistory,
} from "@/features/inspections/hooks/usePropertyHistory";
import { PropertyForm } from "@/features/properties/components/property-form";
import { PROPERTIES_HREF, usePropertyForm } from "@/features/properties/hooks/usePropertyForm";
import { ConflictNotice } from "@/shared/components/conflict-notice";
import { RecordUnavailable } from "@/shared/components/record-unavailable";
import { useIsWide } from "@/shared/useIsDesktop";

import { PageHeader } from "../../shell-header";

// /properties/edit (Figma 71:3087 desktop, 71:3337 celular; o histórico na seção "Imóvel · vistorias (#176)"): a
// mesma tela para novo (sem `id`, "Novo imóvel") e edição. No header, "Voltar", o endereço e o SyncBadge do registro.
// Na edição, o histórico do imóvel: a partir de 1280 px, num Card ao lado do formulário; abaixo, nas abas "Dados |
// Vistorias · N", com a aba no `?tab=` (Dados por padrão), para o "Voltar" da tela de campo e do laudo cair nela. O
// formulário existe uma vez só na página, então a troca é pelo `useIsWide`, não pelo CSS. Em conflito, o aviso com
// "Resolver conflito" acima do formulário (55:5132). Um id que o aparelho não tem é buscado no servidor, com o cliente
// (#101); sem rede, não encontrado ou com falha, o aviso toma o lugar do formulário.

const NEW_CLIENT_HREF = "/clients/edit";
const HISTORY_TAB = "vistorias";

export function PropertyEditScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const wide = useIsWide();
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
  const history = usePropertyHistory(status === "found" ? id : null);

  const formColumn = (
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
  );
  const historyOf = (layout: "card" | "tab") =>
    history.ready ? (
      <PropertyHistory
        layout={layout}
        items={history.items}
        count={history.count}
        newHref={history.newHref}
      />
    ) : null;

  let body = formColumn;
  if (status === "found" && id) {
    body = wide ? (
      <div className="grid grid-cols-[minmax(0,720px)_minmax(320px,400px)] items-start gap-8">
        {formColumn}
        {historyOf("card")}
      </div>
    ) : (
      <Tabs
        value={params.get("tab") === HISTORY_TAB ? HISTORY_TAB : "dados"}
        onValueChange={(tab) =>
          router.replace(
            tab === HISTORY_TAB ? propertyHistoryHref(id) : `/properties/edit?id=${encodeURIComponent(id)}`,
            { scroll: false },
          )
        }
      >
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value={HISTORY_TAB}>
            {history.ready ? `Vistorias · ${history.total}` : "Vistorias"}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dados" className="pt-2">
          {formColumn}
        </TabsContent>
        <TabsContent value={HISTORY_TAB} className="pt-2">
          {historyOf("tab")}
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <>
      <PageHeader title={title} backHref={PROPERTIES_HREF} sync={sync} />
      {unavailable ? (
        <RecordUnavailable {...unavailable} backHref={PROPERTIES_HREF} />
      ) : status === "loading" ? null : (
        body
      )}
    </>
  );
}
