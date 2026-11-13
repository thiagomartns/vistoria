import { type FilterOption, FilterSelect } from "@/shared/components/filter-select";

// Os filtros de /properties (Figma 71:2799 e 71:2803): Cliente e Tipo, um FilterSelect cada. Na barra do desktop, lado
// a lado com 180 px; no Sheet "Filtros" do celular, um campo por filtro, com o Label em cima, em largura total.

type PropertyFiltersProps<TType extends string> = {
  clientId: string | null;
  type: TType | null;
  clientOptions: FilterOption[];
  typeOptions: { value: TType; label: string }[];
  onChange: (filters: { clientId: string | null; type: TType | null }) => void;
  /** `barra` no desktop; `painel` dentro do Sheet. */
  layout: "barra" | "painel";
};

export function PropertyFilters<TType extends string>({
  clientId,
  type,
  clientOptions,
  typeOptions,
  onChange,
  layout,
}: PropertyFiltersProps<TType>) {
  return (
    <>
      <FilterSelect
        label="Cliente"
        allLabel="Todos"
        value={clientId}
        options={clientOptions}
        onChange={(value) => onChange({ clientId: value, type })}
        layout={layout}
      />
      <FilterSelect
        label="Tipo"
        allLabel="Todos"
        value={type}
        options={typeOptions}
        onChange={(value) =>
          onChange({
            clientId,
            type: typeOptions.find((option) => option.value === value)?.value ?? null,
          })
        }
        layout={layout}
      />
    </>
  );
}
