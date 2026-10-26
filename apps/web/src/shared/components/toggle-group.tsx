import { Check } from "lucide-react";
import { type KeyboardEvent, type ReactNode, createContext, useContext, useRef } from "react";

// Escolha única em chips (Figma ToggleGroup 41:1661, ToggleGroup/Item 41:1610): a condição do item na tela de campo,
// o tipo da vistoria em /inspections/new. Semântica de radiogroup: um Tab entra no grupo (no marcado, ou no primeiro),
// as setas, Home e End movem o foco, e Espaço ou Enter marcam. Marcado ganha fundo primary e o Check (no `lg`, só o
// fundo: falta largura). `md` tem itens de 96 px fixos, para o layout não pular ao marcar; `lg` divide a largura;
// `auto` é `lg` no celular e `md` a partir de `md`.
// Inválido é borda destructive; somente leitura (envio em voo, concluída) é muted, e o marcado, secondary com borda
// foreground. Candidato ao Sanjou.

type Size = "md" | "lg" | "auto";

interface GroupState {
  value: string | null;
  size: Size;
  invalid: boolean;
  readOnly: boolean;
  /** O item que recebe o Tab: o marcado, ou o primeiro. */
  tabStop: string | null;
  select: (value: string) => void;
}

const GroupContext = createContext<GroupState | null>(null);

type ToggleGroupProps = {
  value: string | null;
  onValueChange: (value: string) => void;
  /** Os valores na ordem dos itens: o Tab entra no primeiro quando nada está marcado. */
  values: readonly string[];
  size?: Size;
  invalid?: boolean;
  readOnly?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  id?: string;
  className?: string;
  children: ReactNode;
};

export function ToggleGroup({
  value,
  onValueChange,
  values,
  size = "md",
  invalid = false,
  readOnly = false,
  className = "",
  children,
  ...aria
}: ToggleGroupProps) {
  const root = useRef<HTMLDivElement>(null);

  // As setas só movem o foco entre os itens habilitados; marcar continua sendo Espaço ou Enter.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? []),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (current + 1) % items.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (current - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <GroupContext
      value={{
        value,
        size,
        invalid,
        readOnly,
        tabStop: value ?? values[0] ?? null,
        select: (next) => {
          if (!readOnly && next !== value) onValueChange(next);
        },
      }}
    >
      <div
        ref={root}
        role="radiogroup"
        aria-invalid={invalid || undefined}
        aria-readonly={readOnly || undefined}
        onKeyDown={onKeyDown}
        className={`flex items-start ${GROUP_SIZE[size]} ${className}`}
        {...aria}
      >
        {children}
      </div>
    </GroupContext>
  );
}

const GROUP_SIZE: Record<Size, string> = {
  md: "gap-1.5",
  lg: "w-full gap-1",
  auto: "w-full gap-1 md:w-auto md:gap-1.5",
};

const ITEM_SIZE: Record<Size, string> = {
  md: "h-8 w-24 shrink-0 px-3",
  lg: "h-10 min-w-0 flex-1 px-1",
  auto: "h-10 min-w-0 flex-1 px-1 md:h-8 md:w-24 md:flex-none md:shrink-0 md:px-3",
};

const CHECK_SIZE: Record<Size, string> = { md: "", lg: "hidden", auto: "hidden md:block" };

function lookOf(checked: boolean, invalid: boolean, readOnly: boolean): string {
  if (readOnly) {
    return checked
      ? "border-foreground bg-secondary text-foreground"
      : "border-border bg-muted text-muted-foreground";
  }
  const border = invalid ? "border-destructive" : checked ? "border-primary" : "border-input";
  return checked
    ? `${border} bg-primary text-primary-foreground hover:bg-primary/88`
    : `${border} bg-background text-foreground hover:bg-accent`;
}

export function ToggleGroupItem({
  value,
  disabled = false,
  children,
}: {
  value: string;
  /** Opção que existe mas ainda não está disponível (some do Tab e das setas). */
  disabled?: boolean;
  children: ReactNode;
}) {
  const group = useContext(GroupContext);
  if (!group) throw new Error("ToggleGroupItem fica dentro de um ToggleGroup.");
  const checked = group.value === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={group.tabStop === value ? 0 : -1}
      disabled={group.readOnly || disabled}
      data-state={checked ? "on" : "off"}
      onClick={() => group.select(value)}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border text-sm font-medium whitespace-nowrap transition-colors duration-100 ease-standard outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default ${disabled && !group.readOnly ? "disabled:opacity-50" : ""} ${ITEM_SIZE[group.size]} ${lookOf(checked, group.invalid, group.readOnly)}`}
    >
      {checked ? (
        <Check className={`size-4 shrink-0 ${CHECK_SIZE[group.size]}`} aria-hidden="true" />
      ) : null}
      <span className="truncate">{children}</span>
    </button>
  );
}
