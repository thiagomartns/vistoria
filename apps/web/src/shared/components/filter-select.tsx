import { Label } from "@sanjou/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@sanjou/ui/select";
import { useId, useState } from "react";

// Um filtro de lista em Select (Figma FilterSelect, "Componentes novos"), com o item que desliga o filtro ("Todos",
// "Qualquer data") e dois arranjos: na barra do desktop, o nome do filtro vai no texto ("Cliente: todos",
// "Cliente: Imobiliária Horizonte"); no painel (o Sheet "Filtros" do celular), o Label vai em cima e o Select mostra
// só o valor. Os itens só existem com o Select aberto: o Select do Radix monta os itens fechado também, e uma lista
// longa (os 2.500 imóveis do spike 2) pesa a cada render. Candidato ao Sanjou.

/** Valor do item "todos": o Select do Radix não aceita item com valor vazio. */
const ALL = "todos";

export interface FilterOption {
  value: string;
  label: string;
}

export type FilterSelectProps = {
  /** "Cliente": o nome do filtro, no texto da barra, no Label do painel e no aria-label ("Filtrar por cliente"). */
  label: string;
  /** O item que desliga o filtro: "Todos", "Qualquer data". */
  allLabel: string;
  /** O valor escolhido, ou null com "todos". */
  value: string | null;
  /**
   * As opções. Uma função só é chamada com o Select aberto; com ela, passe `selectedLabel`, porque fechado não há
   * opções para achar o texto do escolhido.
   */
  options: FilterOption[] | (() => FilterOption[]);
  /** O texto do valor escolhido; sem ele, sai das opções. */
  selectedLabel?: string | null;
  onChange: (value: string | null) => void;
  /** `barra` no desktop; `painel` dentro do Sheet. */
  layout: "barra" | "painel";
  /** A largura na barra ("w-[180px]"); no painel, o Select ocupa a largura toda. */
  className?: string;
};

const listOf = (options: FilterSelectProps["options"]) =>
  typeof options === "function" ? options() : options;

export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  selectedLabel,
  onChange,
  layout,
  className = "w-[180px]",
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const selected =
    selectedLabel !== undefined
      ? selectedLabel
      : value === null
        ? null
        : (listOf(options).find((option) => option.value === value)?.label ?? null);
  // A barra (escondida por CSS no celular) e o painel do Sheet existem juntos: o id do Label não pode repetir.
  const id = useId();
  const select = (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
    >
      <SelectTrigger
        id={id}
        aria-label={`Filtrar por ${label.toLowerCase()}`}
        className={layout === "barra" ? `${className} shrink-0` : "w-full"}
      >
        <SelectValue>
          {layout === "barra"
            ? `${label}: ${selected ?? allLabel.toLowerCase()}`
            : (selected ?? allLabel)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {open
          ? listOf(options).map((option) => (
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
      <Label htmlFor={id}>{label}</Label>
      {select}
    </div>
  );
}
