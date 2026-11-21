import { Input } from "@sanjou/ui/input";
import { Label } from "@sanjou/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@sanjou/ui/popover";
import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, type Ref, useEffect, useId, useState } from "react";
import { fold } from "@/shared/search";

// A escolha numa lista longa (Figma SearchSelect, "Componentes novos", #225): o mesmo gatilho do SelectTrigger e, aberto,
// o Popover do Sanjou com a busca e a lista. A busca é sem acento e sem caixa, como a das listas; a lista monta no máximo
// `limit` opções, com a linha "Mais N: refine a busca" embaixo. O item "todos" (nos filtros) e o escolhido aparecem
// sempre, mesmo fora das primeiras. As opções só são lidas com o Popover aberto: fechado, nada é montado. Teclado:
// setas, Home e End movem o destaque, Enter escolhe e fecha, Esc fecha e devolve o foco ao gatilho. Candidato ao Sanjou.

export interface SearchOption {
  value: string;
  label: string;
}

/** Valor do item "todos": nunca é o id de um registro. */
const ALL = "\u0000todos";

/**
 * As classes do SelectTrigger do Sanjou, menos a largura, que vem do layout (o app não tem o `cn` do Sanjou para resolver
 * `w-full` contra `w-[220px]`): fechado, o SearchSelect é igual aos outros Selects do formulário.
 */
const TRIGGER =
  "flex h-8 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-base whitespace-nowrap text-foreground shadow-xs transition-colors duration-100 ease-standard outline-none hover:border-gray-10 data-[placeholder]:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive disabled:pointer-events-none disabled:bg-muted disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/** As classes do SelectItem do Sanjou, com o destaque por `data-highlighted`. */
const ITEM =
  "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const COUNT = new Intl.NumberFormat("pt-BR");

export type SearchSelectProps = {
  /** "Imóvel": o nome do campo, no texto da barra, no Label do painel, no aria-label e na busca ("Buscar imóvel…"). */
  label: string;
  /** O valor escolhido, ou null sem escolha ("todos" nos filtros). */
  value: string | null;
  /** As opções, em ordem. Uma função só é chamada com o Popover aberto; com ela, passe `selectedLabel`. */
  options: SearchOption[] | (() => SearchOption[]);
  /** O texto do valor escolhido; sem ele, sai das opções. */
  selectedLabel?: string | null;
  onChange: (value: string | null) => void;
  /** Nos filtros, o item que desliga o filtro ("Todos"); nos formulários, nenhum. */
  allLabel?: string;
  /** O texto do gatilho sem escolha, nos formulários ("Escolha o imóvel"). */
  placeholder?: string;
  /** "Nenhum imóvel encontrado". */
  emptyText?: string;
  /**
   * `barra` no desktop ("Imóvel: todos"), `painel` no Sheet (o Label em cima) e `campo` num formulário, dentro do
   * `FormControl`, que passa `id`, `aria-describedby` e `aria-invalid`.
   */
  layout: "barra" | "painel" | "campo";
  /** A largura do gatilho na barra ("w-[220px]"); no painel e no campo, ele ocupa a largura toda. */
  className?: string;
  /** Quantas opções a lista monta, no máximo. */
  limit?: number;
  disabled?: boolean;
  id?: string;
  ref?: Ref<HTMLButtonElement>;
  onBlur?: () => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

const listOf = (options: SearchSelectProps["options"]) =>
  typeof options === "function" ? options() : options;

interface Row {
  value: string;
  label: string;
}

/**
 * As linhas da lista aberta: o "todos", o escolhido se ficou fora das primeiras `limit`, e as primeiras `limit` que
 * casam com a busca. `more` conta as que ficaram de fora.
 */
export function searchRows(
  options: readonly SearchOption[],
  query: string,
  { value, allLabel, limit }: { value: string | null; allLabel?: string; limit: number },
): { rows: Row[]; more: number; matched: number } {
  const needle = fold(query.trim());
  const matches =
    needle === "" ? options : options.filter((option) => fold(option.label).includes(needle));
  const shown = matches.slice(0, limit);
  const rows: Row[] = allLabel === undefined ? [] : [{ value: ALL, label: allLabel }];
  if (value !== null && !shown.some((option) => option.value === value)) {
    const chosen = matches.find((option) => option.value === value);
    if (chosen) rows.push(chosen);
  }
  rows.push(...shown);
  return { rows, more: matches.length - shown.length, matched: matches.length };
}

export function SearchSelect({
  label,
  value,
  options,
  selectedLabel,
  onChange,
  allLabel,
  placeholder,
  emptyText = "Nenhum resultado",
  layout,
  className = "w-[180px]",
  limit = 50,
  disabled,
  id,
  ref,
  onBlur,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const generated = useId();
  const triggerId = id ?? `${generated}-gatilho`;
  const listId = `${generated}-lista`;
  const optionId = (index: number) => `${generated}-opcao-${index}`;

  const all = open ? listOf(options) : [];
  const { rows, more, matched } = searchRows(all, query, { value, allLabel, limit });
  const selected =
    selectedLabel !== undefined
      ? selectedLabel
      : value === null
        ? null
        : (listOf(options).find((option) => option.value === value)?.label ?? null);
  const current = value ?? ALL;

  // A opção em destaque fica à vista quando as setas a levam para fora da lista rolada.
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  });

  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setQuery("");
    const opened = searchRows(listOf(options), "", { value, allLabel, limit }).rows;
    setActive(
      Math.max(
        0,
        opened.findIndex((row) => row.value === current),
      ),
    );
  };

  const search = (next: string) => {
    setQuery(next);
    // Buscando, o destaque vai para a primeira opção que casa, não para o "todos".
    setActive(allLabel !== undefined && next.trim() !== "" ? 1 : 0);
  };

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onChange(row.value === ALL ? null : row.value);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = rows.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      setActive(move);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[active]);
    }
  };

  const text =
    layout === "barra"
      ? `${label}: ${selected ?? (allLabel ?? "").toLowerCase()}`
      : (selected ?? allLabel ?? placeholder ?? "");
  const field = label.toLowerCase();

  const picker = (
    <Popover open={open} onOpenChange={openChange} modal>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          id={triggerId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-label={layout === "campo" ? undefined : `Filtrar por ${field}`}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
          onBlur={onBlur}
          data-placeholder={selected === null && allLabel === undefined ? "" : undefined}
          className={`${TRIGGER} ${layout === "barra" ? `${className} shrink-0` : "w-full"}`}
        >
          <span className="line-clamp-1 text-left">{text}</span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* Sempre embaixo do gatilho (Figma): sem virar para cima quando a lista é maior que o espaço, ela encolhe até a
          altura disponível e rola. */}
      <PopoverContent
        align="start"
        side="bottom"
        avoidCollisions={false}
        collisionPadding={8}
        className={`flex max-h-(--radix-popover-content-available-height) flex-col gap-1 p-1 ${
          layout === "barra"
            ? "w-[max(var(--radix-popover-trigger-width),20rem)] max-w-[calc(100vw-2rem)]"
            : "w-(--radix-popover-trigger-width)"
        }`}
      >
        <Input
          className="shrink-0"
          role="combobox"
          aria-label={`Buscar ${field}`}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows.length > 0 ? optionId(active) : undefined}
          autoComplete="off"
          placeholder={`Buscar ${field}…`}
          value={query}
          onChange={(event) => search(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {rows.map((row, index) => (
            <li
              key={row.value}
              id={optionId(index)}
              role="option"
              aria-selected={row.value === current}
              data-highlighted={index === active ? "" : undefined}
              className={ITEM}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(row)}
            >
              {row.label}
              {row.value === current ? (
                <span className="absolute right-2 grid size-4 place-items-center">
                  <Check aria-hidden="true" />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {matched === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</p>
        ) : null}
        <p
          aria-live="polite"
          className="empty:hidden border-t border-border px-2 py-1.5 text-xs text-muted-foreground"
        >
          {more > 0 ? `Mais ${COUNT.format(more)}: refine a busca` : ""}
        </p>
      </PopoverContent>
    </Popover>
  );

  if (layout !== "painel") return picker;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={triggerId}>{label}</Label>
      {picker}
    </div>
  );
}
