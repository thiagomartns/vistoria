import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";

// Os filtros de /properties (Figma 71:2799 e 71:2803): "Cliente: todos" e "Tipo: todos". Na barra do desktop, lado a
// lado com 180 px; no Sheet "Filtros" do celular, um embaixo do outro, em largura total.

/** Valor do item "todos": o Select do Radix não aceita item com valor vazio. */
const ALL = "todos";

export interface FilterOption {
  value: string;
  label: string;
}

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
  const width = layout === "barra" ? "w-[180px] shrink-0" : "w-full";
  return (
    <>
      <Select
        value={clientId ?? ALL}
        onValueChange={(value) => onChange({ clientId: value === ALL ? null : value, type })}
      >
        <SelectTrigger aria-label="Filtrar por cliente" className={width}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Cliente: todos</SelectItem>
          {clientOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={type ?? ALL}
        onValueChange={(value) =>
          onChange({ clientId, type: value === ALL ? null : (value as TType) })
        }
      >
        <SelectTrigger aria-label="Filtrar por tipo" className={width}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tipo: todos</SelectItem>
          {typeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
