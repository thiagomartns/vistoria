"use client";

import { useSearchParams } from "next/navigation";

import { useInspectionConflict } from "@/features/inspections/hooks/useInspectionConflict";
import { INSPECTIONS_HREF, inspectionHref } from "@/features/inspections/hooks/useInspections";

import { ConflictPage } from "../../conflict-page";

// /inspections/conflict?id=: só o que os dois lados mudaram, por ambiente e item; aberta direto, sem histórico, volta
// para a tela de campo. Os tipos "excluído" e "exclusão alterada" chegam na #109.

export const NO_CONFLICT = "Esta vistoria não tem conflito para resolver.";

export function ConflictScreen() {
  const id = useSearchParams().get("id");
  const conflict = useInspectionConflict(id);

  return (
    <ConflictPage
      conflict={conflict}
      recordHref={id ? inspectionHref(id) : INSPECTIONS_HREF}
      listHref={INSPECTIONS_HREF}
      noConflict={NO_CONFLICT}
      openLabel="Abrir a vistoria"
    />
  );
}
