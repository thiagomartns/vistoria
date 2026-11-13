import { Label } from "@sanjou/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";
import { useState } from "react";

// Os filtros de /inspections (Figma "Busca e filtros (#175)"): Cliente, Imóvel, Tipo, Status e Período. Na barra do
// desktop (estado 1), lado a lado, com o filtro no texto ("Cliente: todos"); no Sheet "Filtros" do celular (estado 2),
// um campo por filtro, com o Label em cima e o valor no Select. Os itens só existem com o Select aberto: o Radix monta
// os itens fechado também, e o Imóvel do spike 2 tem 2.500 (a lista renderiza a cada segundo, na leitura da fila).

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
  /** O texto do valor escolhido ("Imobiliária Horizonte"), ou null com "todos". */
  selectedLabel: string | null;
  /** As opções, montadas só quando o Select abre. */
  options: () => InspectionFilterOption[];
  onChange: (value: string | null) => void;
}

type InspectionFiltersProps = {
  fields: InspectionFilterField[];
  /** `barra` no desktop; `painel` dentro do Sheet. */
  layout: "barra" | "painel";
};

/** As larguras da barra do desktop, do Figma, com 10 px a menos no Cliente e no Período: em 1440 px, "Limpar filtros" cabe na linha. */
const BAR_WIDTH: Record<string, string> = {
  cliente: "w-[240px]",
  imovel: "w-[220px]",
  tipo: "w-[140px]",
  status: "w-[170px]",
  periodo: "w-[200px]",
};

function FilterSelect({
  field,
  layout,
}: {
  field: InspectionFilterField;
  layout: "barra" | "painel";
}) {
  const [open, setOpen] = useState(false);
  const selected = field.selectedLabel;
  const shown = selected ?? field.allLabel;
  const id = `filtro-${field.name}`;
  const select = (
    <Select
      open={open}
      onOpenChange={setOpen}
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
        {open
          ? field.options().map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))
          : null}
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
