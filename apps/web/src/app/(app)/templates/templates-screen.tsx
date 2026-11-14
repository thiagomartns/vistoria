"use client";

import { Button } from "@sanjou/ui/button";
import { Input } from "@sanjou/ui/input";
import { ListChecks, Plus, Search } from "lucide-react";
import Link from "next/link";

import { TemplatesList } from "@/features/templates/components/templates-list";
import { useTemplates } from "@/features/templates/hooks/useTemplates";
import { EmptyState } from "@/shared/components/empty-state";
import { useIsDesktop } from "@/shared/useIsDesktop";

// /templates (Figma "Roteiros (#173)", estados 1 e 2): busca local pelo nome, "Novo roteiro" e a lista em ordem de
// nome. Sem roteiro no aparelho, o EmptyState sem ação, porque "Novo roteiro" já está acima. Sem exclusão na V1.

const NEW_TEMPLATE_HREF = "/templates/edit";

export function TemplatesScreen() {
  const { ready, empty, rows, search, setSearch } = useTemplates();
  const desktop = useIsDesktop();

  if (!ready) return null;

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:gap-2">
        <Input
          type="search"
          aria-label="Buscar roteiros"
          placeholder={desktop ? "Buscar roteiro" : "Buscar"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="lg:min-w-0 lg:flex-1"
        />
        <Button asChild size="lg" className="w-full lg:h-8 lg:w-auto lg:px-3">
          <Link href={NEW_TEMPLATE_HREF}>
            <Plus aria-hidden="true" />
            Novo roteiro
          </Link>
        </Button>
      </div>
      {empty ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhum roteiro ainda"
          description="Crie um roteiro com os ambientes e itens que você vistoria sempre. A vistoria de entrada parte dele."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum roteiro encontrado"
          description="Confira a busca ou crie um roteiro novo."
        />
      ) : (
        <TemplatesList items={rows} />
      )}
    </>
  );
}
