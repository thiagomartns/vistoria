import { FilterSelect, type FilterSelectProps } from "@/shared/components/filter-select";
import { SearchSelect } from "@/shared/components/search-select";

// Os filtros de /inspections (Figma "Busca e filtros (#175)"): Cliente, Imóvel, Tipo, Status e Período. Cliente e Imóvel,
// com centenas ou milhares de opções, abrem o SearchSelect, com busca (Figma "Escolha com busca (#225)"); os outros, um
// FilterSelect. Na barra do desktop (estado 1), lado a lado; no Sheet "Filtros" do celular (estado 2), um campo por filtro.

export type InspectionFilterField = Omit<FilterSelectProps, "layout" | "className" | "allLabel"> & {
  /** "cliente": a chave da largura na barra. */
  name: string;
  allLabel: string;
  /** Com busca (o SearchSelect), com o aviso de quando nada casa: "Nenhum imóvel encontrado". */
  search?: { emptyText: string };
};

/** As larguras da barra do desktop, do Figma, com 10 px a menos no Cliente e no Período: em 1440 px, "Limpar filtros" cabe na linha. */
const BAR_WIDTH: Record<string, string> = {
  cliente: "w-[240px]",
  imovel: "w-[220px]",
  tipo: "w-[140px]",
  status: "w-[170px]",
  periodo: "w-[200px]",
};

export function InspectionFilters({
  fields,
  layout,
}: {
  fields: InspectionFilterField[];
  /** `barra` no desktop; `painel` dentro do Sheet. */
  layout: "barra" | "painel";
}) {
  return (
    <>
      {fields.map(({ name, search, ...field }) =>
        search ? (
          <SearchSelect
            key={name}
            {...field}
            emptyText={search.emptyText}
            layout={layout}
            className={BAR_WIDTH[name]}
          />
        ) : (
          <FilterSelect key={name} {...field} layout={layout} className={BAR_WIDTH[name]} />
        ),
      )}
    </>
  );
}
