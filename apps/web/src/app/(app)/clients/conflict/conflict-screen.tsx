"use client";

import { useSearchParams } from "next/navigation";

import { clientHref } from "@/features/clients/components/clients-list";
import { useClientConflict } from "@/features/clients/hooks/useClientConflict";
import { CLIENTS_HREF } from "@/features/clients/hooks/useClientForm";

import { ConflictPage } from "../../conflict-page";

// /clients/conflict?id= (ConflictResolver 32:1787 tipo edição, ADR 0038): os campos que os dois lados mudaram, num grupo
// só; aberta direto, sem histórico, volta para o formulário.

export const NO_CONFLICT = "Este cliente não tem conflito para resolver.";

export function ClientConflictScreen() {
  const id = useSearchParams().get("id");
  const conflict = useClientConflict(id);

  return (
    <ConflictPage
      conflict={conflict}
      recordHref={id ? clientHref(id) : CLIENTS_HREF}
      listHref={CLIENTS_HREF}
      noConflict={NO_CONFLICT}
      openLabel="Abrir o cliente"
    />
  );
}
