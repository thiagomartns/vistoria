"use client";

import { useSearchParams } from "next/navigation";

import { propertyHref } from "@/features/properties/components/properties-list";
import { usePropertyConflict } from "@/features/properties/hooks/usePropertyConflict";
import { PROPERTIES_HREF } from "@/features/properties/hooks/usePropertyForm";

import { ConflictPage } from "../../conflict-page";

// /properties/conflict?id= (ConflictResolver 32:1787 tipo edição, ADR 0038): os campos que os dois lados mudaram,
// num grupo só; aberta direto, sem histórico, volta para o formulário.

export const NO_CONFLICT = "Este imóvel não tem conflito para resolver.";

export function PropertyConflictScreen() {
  const id = useSearchParams().get("id");
  const conflict = usePropertyConflict(id);

  return (
    <ConflictPage
      conflict={conflict}
      recordHref={id ? propertyHref(id) : PROPERTIES_HREF}
      listHref={PROPERTIES_HREF}
      noConflict={NO_CONFLICT}
      openLabel="Abrir o imóvel"
    />
  );
}
