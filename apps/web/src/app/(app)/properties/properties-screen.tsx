"use client";

import { Button } from "@sanjou/ui/button";
import { Input } from "@sanjou/ui/input";
import { House, Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PropertiesList } from "@/features/properties/components/properties-list";
import { PropertyFilters } from "@/features/properties/components/property-filters";
import { useProperties } from "@/features/properties/hooks/useProperties";
import { EmptyState } from "@/shared/components/empty-state";
import { Sheet } from "@/shared/components/sheet";
import { useIsDesktop, useIsLarge } from "@/shared/useIsDesktop";

// /properties (Figma 71:2726 desktop, 71:2900 celular): busca local por endereço, bairro e cidade, filtros por cliente
// e tipo, "Novo imóvel" e a lista em ordem de endereço. No celular, os filtros ficam no Sheet "Filtros". Sem exclusão
// na V1 (nota 71:3086). A lista monta 50 linhas por vez, com "Mostrar mais" e o contador no desktop, como
// /inspections, e só a versão da largura (#223).

const NEW_PROPERTY_HREF = "/properties/edit";

export function PropertiesScreen() {
  const properties = useProperties();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const desktop = useIsDesktop();
  const large = useIsLarge();

  if (!properties.ready) return null;

  if (properties.empty) {
    return (
      <EmptyState
        icon={House}
        title="Nenhum imóvel ainda"
        description="Cadastre os imóveis que você vistoria."
        action={
          <Button asChild>
            <Link href={NEW_PROPERTY_HREF}>
              <Plus aria-hidden="true" />
              Novo imóvel
            </Link>
          </Button>
        }
      />
    );
  }

  const filters = (layout: "barra" | "painel") => (
    <PropertyFilters
      layout={layout}
      clientId={properties.filters.clientId}
      type={properties.filters.type}
      clientOptions={properties.clientOptions}
      typeOptions={properties.typeOptions}
      onChange={properties.setFilters}
    />
  );

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:gap-2">
        <div className="flex gap-2 lg:min-w-0 lg:flex-1">
          <Input
            type="search"
            aria-label="Buscar imóveis"
            placeholder={desktop ? "Buscar por endereço, bairro ou cidade" : "Buscar"}
            value={properties.search}
            onChange={(event) => properties.setSearch(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button
            variant="outline"
            className="shrink-0 lg:hidden"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {properties.activeFilters > 0 ? `Filtros · ${properties.activeFilters}` : "Filtros"}
          </Button>
        </div>
        <div className="hidden lg:contents">{filters("barra")}</div>
        <Button asChild size="lg" className="w-full lg:h-8 lg:w-auto lg:px-3">
          <Link href={NEW_PROPERTY_HREF}>
            <Plus aria-hidden="true" />
            Novo imóvel
          </Link>
        </Button>
      </div>
      {properties.rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum imóvel encontrado"
          description="Confira a busca e os filtros ou cadastre um imóvel novo."
        />
      ) : (
        <>
          <PropertiesList items={properties.rows} layout={large ? "tabela" : "linhas"} />
          {properties.hidden > 0 ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full lg:h-8 lg:w-auto lg:self-center lg:px-3"
              onClick={properties.showMore}
            >
              Mostrar mais
            </Button>
          ) : null}
          <p className="hidden text-sm text-muted-foreground lg:block">{properties.count}</p>
        </>
      )}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} side="baixo" title="Filtros">
        <div className="flex flex-col gap-3 px-5 pb-5">{filters("painel")}</div>
      </Sheet>
    </>
  );
}
