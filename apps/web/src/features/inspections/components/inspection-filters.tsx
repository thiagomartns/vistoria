import { Label } from "@sanjou/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";

// Os filtros de /inspections (Figma "Busca e filtros (#175)"): Cliente, Imóvel, Tipo, Status e Período. Na barra do
// desktop (estado 1), lado a lado, com o filtro no texto ("Cliente: todos"); no Sheet "Filtros" do celular (estado 2),
// um campo por filtro, com o Label em cima e o valor no Select.

/** Valor do item "todos": o Select do Radix não aceita item com valor vazio. */
const ALL = "todos";

export interface InspectionFilterOption {
  value: string;
  label: string;
}

export interface InspectionFilterField {
  /** "cliente": o id do campo e o fim do aria-label ("Filtrar por cliente"). */
  name: string;
  /** "Cliente". */
  label: string;
  /** O item que desliga o filtro: "Todos", "Qualquer data". */
  allLabel: string;
  value: string | null;
  options: InspectionFilterOption[];
  onChange: (value: string | null) => void;
}

type InspectionFiltersProps = {
  fields: InspectionFilterField[];
  /** `barra` no desktop; `painel` dentro do Sheet. */
  layout: "barra" | "painel";
};

/** As larguras da barra do desktop, do Figma, pela ordem dos campos. */
const BAR_WIDTH: Record<string, string> = {
  cliente: "w-[250px]",
  imovel: "w-[220px]",
  tipo: "w-[140px]",
  status: "w-[170px]",
  periodo: "w-[210px]",
};

function FilterSelect({
  field,
  layout,
}: {
  field: InspectionFilterField;
  layout: "barra" | "painel";
}) {
  const selected = field.options.find((option) => option.value === field.value)?.label;
  const shown = selected ?? field.allLabel;
  const id = `filtro-${field.name}`;
  const select = (
    <Select
      value={field.value ?? ALL}
      onValueChange={(value) => field.onChange(value === ALL ? null : value)}
    >
      <SelectTrigger
        id={id}
        aria-label={`Filtrar por ${field.label.toLowerCase()}`}
        className={
          layout === "barra" ? `${BAR_WIDTH[field.name] ?? "w-[180px]"} shrink-0` : "w-full"
        }
      >
        <SelectValue>
          {layout === "barra"
            ? `${field.label}: ${selected ?? field.allLabel.toLowerCase()}`
            : shown}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{field.allLabel}</SelectItem>
        {field.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (layout === "barra") return select;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{field.label}</Label>
      {select}
    </div>
  );
}

export function InspectionFilters({ fields, layout }: InspectionFiltersProps) {
  return (
    <>
      {fields.map((field) => (
        <FilterSelect key={field.name} field={field} layout={layout} />
      ))}
    </>
  );
}
