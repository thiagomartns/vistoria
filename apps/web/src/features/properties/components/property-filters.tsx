import { type FilterOption, FilterSelect } from "@/shared/components/filter-select";
import { SearchSelect } from "@/shared/components/search-select";

// Os filtros de /properties (Figma 71:2799 e 71:2803): Cliente, com busca (o SearchSelect, Figma "Escolha com busca
// (#225)"), e Tipo, num FilterSelect. Na barra do desktop, lado a lado com 180 px; no Sheet "Filtros" do celular, um
// campo por filtro, com o Label em cima, em largura total.

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
      <SearchSelect
        label="Cliente"
        allLabel="Todos"
        emptyText="Nenhum cliente encontrado"
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
