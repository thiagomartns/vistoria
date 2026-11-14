"use client";

import { Button } from "@sanjou/ui/button";
import { Input } from "@sanjou/ui/input";
import { ClipboardList, Plus, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  type InspectionFilterField,
  InspectionFilters,
} from "@/features/inspections/components/inspection-filters";
import { InspectionsList } from "@/features/inspections/components/inspections-list";
import { useInspections } from "@/features/inspections/hooks/useInspections";
import { EmptyState } from "@/shared/components/empty-state";
import { Sheet } from "@/shared/components/sheet";
import { useIsDesktop } from "@/shared/useIsDesktop";

// /inspections (wireframe 67:1490 e 67:1649; busca e filtros no Figma "Busca e filtros (#175)"): a busca e "Nova
// vistoria", os filtros (na barra do desktop, no Sheet "Filtros" do celular) e a lista do banco local, em andamento
// primeiro, com o "···" de excluir na linha em andamento (desktop, #107). A lista monta 50 linhas por vez, com "Mostrar
// mais" (ADR 0047), sobre o resultado filtrado.

const NEW_INSPECTION_HREF = "/inspections/new";

/** O texto da opção escolhida, ou null com "todos". */
const labelOf = (options: readonly { value: string; label: string }[], value: string | null) =>
  options.find((option) => option.value === value)?.label ?? null;

/** O valor do Select como o filtro o tipa: um dos valores das opções, ou "todos". */
const pick = <T extends string>(options: readonly { value: T }[], value: string | null): T | null =>
  options.find((option) => option.value === value)?.value ?? null;

export function InspectionsScreen() {
  const inspections = useInspections();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const desktop = useIsDesktop();
  const { ready, empty, rows, count, hidden, showMore, remove, filters, setFilters } = inspections;

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

  const fields: InspectionFilterField[] = [
    {
      name: "cliente",
      label: "Cliente",
      allLabel: "Todos",
      value: filters.clientId,
      selectedLabel: inspections.clientLabel,
      options: inspections.clientOptions,
      onChange: (clientId) => setFilters({ clientId }),
    },
    {
      name: "imovel",
      label: "Imóvel",
      allLabel: "Todos",
      value: filters.propertyId,
      selectedLabel: inspections.propertyLabel,
      options: inspections.propertyOptions,
      onChange: (propertyId) => setFilters({ propertyId }),
    },
    {
      name: "tipo",
      label: "Tipo",
      allLabel: "Todos",
      value: filters.kind,
      selectedLabel: labelOf(inspections.kindOptions, filters.kind),
      options: () => inspections.kindOptions,
      onChange: (kind) => setFilters({ kind: pick(inspections.kindOptions, kind) }),
    },
    {
      name: "status",
      label: "Status",
      allLabel: "Todos",
      value: filters.status,
      selectedLabel: labelOf(inspections.statusOptions, filters.status),
      options: () => inspections.statusOptions,
      onChange: (status) => setFilters({ status: pick(inspections.statusOptions, status) }),
    },
    {
      name: "periodo",
      label: "Período",
      allLabel: "Qualquer data",
      value: filters.period,
      selectedLabel: labelOf(inspections.periodOptions, filters.period),
      options: () => inspections.periodOptions,
      onChange: (period) => setFilters({ period: pick(inspections.periodOptions, period) }),
    },
  ];
  const active = inspections.activeFilters;

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-2">
        <div className="flex gap-2 lg:w-[400px]">
          <Input
            type="search"
            aria-label="Buscar vistorias"
            placeholder={desktop ? "Buscar por endereço ou cliente" : "Buscar"}
            value={filters.query}
            onChange={(event) => setFilters({ query: event.target.value })}
            className="min-w-0 flex-1"
          />
          <Button
            variant={active > 0 ? "secondary" : "outline"}
            className="shrink-0 lg:hidden"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {active > 0 ? `Filtros · ${active}` : "Filtros"}
          </Button>
        </div>
        <Button asChild size="lg" className="w-full lg:h-8 lg:w-auto lg:px-3">
          <Link href={NEW_INSPECTION_HREF}>
            <Plus aria-hidden="true" />
            Nova vistoria
          </Link>
        </Button>
      </div>
      <div className="hidden lg:flex lg:flex-wrap lg:items-center lg:gap-2">
        <InspectionFilters fields={fields} layout="barra" />
        {inspections.filtered ? (
          <Button variant="ghost" onClick={inspections.clearFilters}>
            <X aria-hidden="true" />
            Limpar filtros
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nenhuma vistoria encontrada"
          description="Nenhuma vistoria deste aparelho combina com a busca e os filtros."
          action={
            <Button variant="outline" onClick={inspections.clearFilters}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <>
          <InspectionsList items={rows} onDelete={remove} />
          {hidden > 0 ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full lg:h-8 lg:w-auto lg:self-center lg:px-3"
              onClick={showMore}
            >
              Mostrar mais
            </Button>
          ) : null}
          <p className="hidden text-sm text-muted-foreground lg:block">{count}</p>
        </>
      )}
      <Sheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        side="baixo"
        title="Filtros"
        description={`${inspections.matched} com estes filtros.`}
      >
        <div className="flex flex-col gap-4 px-5 pb-5">
          <InspectionFilters fields={fields} layout="painel" />
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={inspections.clearSelects}
            >
              Limpar
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setFiltersOpen(false)}>
              Ver {inspections.matched}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
