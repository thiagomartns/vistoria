import { FilterSelect, type FilterSelectProps } from "@/shared/components/filter-select";

// Os filtros de /inspections (Figma "Busca e filtros (#175)"): Cliente, Imóvel, Tipo, Status e Período, um FilterSelect
// cada. Na barra do desktop (estado 1), lado a lado; no Sheet "Filtros" do celular (estado 2), um campo por filtro.

export type InspectionFilterField = Omit<FilterSelectProps, "layout" | "className"> & {
  /** "cliente": a chave da largura na barra. */
  name: string;
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
      {fields.map(({ name, ...field }) => (
        <FilterSelect key={name} {...field} layout={layout} className={BAR_WIDTH[name]} />
      ))}
    </>
  );
}
