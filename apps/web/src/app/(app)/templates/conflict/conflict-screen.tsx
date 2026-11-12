"use client";

import { useSearchParams } from "next/navigation";

import { templateHref } from "@/features/templates/components/templates-list";
import { useTemplateConflict } from "@/features/templates/hooks/useTemplateConflict";
import { TEMPLATES_HREF } from "@/features/templates/hooks/useTemplateForm";

import { ConflictPage } from "../../conflict-page";

// /templates/conflict?id= (Figma "Roteiros (#173)", estado 7; ADR 0038 e 0057): Nome e Ambientes, só os campos que os
// dois lados mudaram, num grupo "Roteiro"; aberta direto, sem histórico, volta para o editor.

export const NO_CONFLICT = "Este roteiro não tem conflito para resolver.";

export function TemplateConflictScreen() {
  const id = useSearchParams().get("id");
  const conflict = useTemplateConflict(id);

  return (
    <ConflictPage
      conflict={conflict}
      recordHref={id ? templateHref(id) : TEMPLATES_HREF}
      listHref={TEMPLATES_HREF}
      noConflict={NO_CONFLICT}
      openLabel="Abrir o roteiro"
    />
  );
}
