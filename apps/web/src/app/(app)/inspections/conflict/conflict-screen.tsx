"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useInspectionConflict } from "@/features/inspections/hooks/useInspectionConflict";
import { INSPECTIONS_HREF, inspectionHref } from "@/features/inspections/hooks/useInspections";
import { DeletedConflict, RemovalConflictDialog } from "@/shared/components/conflict-resolver";

import { ConflictPage } from "../../conflict-page";
import { PageHeader } from "../../shell-header";
import { InspectionEditScreen } from "../edit/inspection-edit-screen";

// /inspections/conflict?id=, pelo tipo do conflito (ADR 0040):
// - edição: só o que os dois lados mudaram, por ambiente e item; aberta direto, sem histórico, volta para a tela de campo;
// - excluído (#107, estado 7): recriar vai para a tela de campo da vistoria nova; descartar, para a lista;
// - exclusão alterada (#107, estado 8): o "Excluir mesmo assim?" sobre a tela de campo só leitura, com o que o servidor
//   tem. Excluir volta para a lista; Cancelar fica na tela de campo, editável; o × sai sem decidir.

export const NO_CONFLICT = "Esta vistoria não tem conflito para resolver.";

export function ConflictScreen() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const conflict = useInspectionConflict(id);
  const [busy, setBusy] = useState(false);
  const recordHref = id ? inspectionHref(id) : INSPECTIONS_HREF;

  function leave() {
    if (window.history.length > 1) router.back();
    else router.replace(recordHref);
  }

  if (conflict.kind === "deleted" && conflict.deleted) {
    const { deleted } = conflict;
    return (
      <>
        <PageHeader title="Conflito" backHref={recordHref} />
        <DeletedConflict
          {...deleted}
          busy={busy}
          onRecreate={async () => {
            setBusy(true);
            const created = await conflict.recreate();
            router.replace(created ? inspectionHref(created) : INSPECTIONS_HREF);
          }}
          onDiscard={async () => {
            setBusy(true);
            await conflict.discard();
            router.replace(INSPECTIONS_HREF);
          }}
        />
      </>
    );
  }

  if (conflict.kind === "removal") {
    return (
      <>
        <InspectionEditScreen />
        <RemovalConflictDialog
          open
          onDismiss={leave}
          onKeep={() => {
            conflict.keep();
            router.replace(recordHref);
          }}
          onConfirm={async () => {
            await conflict.confirmDeletion();
            router.push(INSPECTIONS_HREF);
          }}
        />
      </>
    );
  }

  return (
    <ConflictPage
      conflict={conflict}
      recordHref={recordHref}
      listHref={INSPECTIONS_HREF}
      noConflict={NO_CONFLICT}
      openLabel="Abrir a vistoria"
    />
  );
}
