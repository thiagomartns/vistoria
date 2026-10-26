"use client";

import { Button } from "@sanjou/ui/button";
import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";

import { InspectionsList } from "@/features/inspections/components/inspections-list";
import { useInspections } from "@/features/inspections/hooks/useInspections";
import { EmptyState } from "@/shared/components/empty-state";

// /inspections (wireframe 67:1490 e 67:1649): "Nova vistoria" e a lista do banco local, em andamento primeiro. Busca e
// filtros chegam no M5.

const NEW_INSPECTION_HREF = "/inspections/new";

export function InspectionsScreen() {
  const { ready, empty, rows, count } = useInspections();

  if (!ready) return null;

  if (empty) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Nenhuma vistoria ainda"
        description="Comece cadastrando um cliente e um imóvel, ou crie a primeira vistoria a partir do roteiro padrão."
        action={
          <Button asChild>
            <Link href={NEW_INSPECTION_HREF}>
              <Plus aria-hidden="true" />
              Nova vistoria
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="flex md:justify-end">
        <Button asChild size="lg" className="w-full md:h-8 md:w-auto md:px-3">
          <Link href={NEW_INSPECTION_HREF}>
            <Plus aria-hidden="true" />
            Nova vistoria
          </Link>
        </Button>
      </div>
      <InspectionsList items={rows} />
      <p className="hidden text-sm text-muted-foreground md:block">{count}</p>
    </>
  );
}
