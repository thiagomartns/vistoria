import { Button } from "@sanjou/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CloudAlert,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

// Formulário profundo em etapas (Figma StepperForm 27:1220, StepperForm/Etapa 26:1145). No desktop, a coluna de
// etapas ao lado do conteúdo e o rodapé Anterior / posição / Próximo, dentro de um card; no celular, a faixa rolável
// de chips no topo (a atual sempre à vista), o conteúdo e a barra com Anterior e Próximo de largura cheia, as duas
// presas à tela enquanto o conteúdo rola. Etapa: ícone + texto em todo estado; a atual leva aria-current="step".
// Alt+← e Alt+→ trocam de etapa. Quem usa decide se Próximo valida; o sync da entidade inteira fica no cabeçalho da
// tela, não aqui. Candidato ao Sanjou.

export type StepState = "pendente" | "completa" | "erro" | "conflito";

export interface StepperStep {
  id: string;
  label: string;
  state: StepState;
  /** "3 de 8", "2 erros". */
  meta: string;
}

const LOOK: Record<StepState, { icon: LucideIcon; iconColor: string; meta: string }> = {
  pendente: { icon: Circle, iconColor: "text-foreground", meta: "text-muted-foreground" },
  completa: { icon: CircleCheck, iconColor: "text-success-text", meta: "text-success-text" },
  erro: { icon: CircleAlert, iconColor: "text-danger-text", meta: "text-danger-text" },
  conflito: { icon: CloudAlert, iconColor: "text-danger-text", meta: "text-danger-text" },
};

export function StepperFormStep({
  index,
  step,
  current,
  onSelect,
}: {
  index: number;
  step: StepperStep;
  current: boolean;
  onSelect: () => void;
}) {
  const { icon: Icon, iconColor, meta } = LOOK[step.state];
  return (
    <button
      type="button"
      aria-current={current ? "step" : undefined}
      data-state={step.state}
      data-step={index}
      onClick={onSelect}
      className={`flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:h-10 md:w-full md:gap-2 md:rounded-md md:border-0 ${
        current
          ? "border-2 border-primary bg-accent font-semibold"
          : "border border-border bg-background font-medium hover:bg-accent md:bg-transparent"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${iconColor}`} aria-hidden="true" />
      <span className="text-foreground md:min-w-0 md:flex-1 md:truncate md:text-left">
        {step.label}
      </span>
      <span className={`shrink-0 text-xs font-medium ${meta}`}>{step.meta}</span>
    </button>
  );
}

/** O ancestral que rola (o `main` do shell), para o conteúdo voltar ao topo ao trocar de etapa. */
function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

type StepperFormProps = {
  /** Título da coluna de etapas ("Ambientes"); no celular, só o nome acessível da faixa. */
  title: string;
  /** "2 de 7 concluídos". */
  summary: string;
  steps: StepperStep[];
  current: number;
  onStepChange: (index: number) => void;
  /** "Cozinha · 3 de 7". */
  position: string;
  /** Próximo indisponível (última etapa sem ação de concluir). */
  nextDisabled?: boolean;
  children: ReactNode;
};

export function StepperForm({
  title,
  summary,
  steps,
  current,
  onStepChange,
  position,
  nextDisabled = false,
  children,
}: StepperFormProps) {
  const strip = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hasPrevious = current > 0;
  const hasNext = current < steps.length - 1 && !nextDisabled;

  // Ao trocar de etapa: a atual fica à vista na faixa do celular (no desktop a coluna já mostra todas), e o conteúdo
  // volta ao topo, onde quer que ele role (a página no celular, o painel no desktop).
  useEffect(() => {
    strip.current
      ?.querySelector(`[data-step="${current}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    content.current?.scrollTo?.({ top: 0 });
    scrollParentOf(strip.current)?.scrollTo?.({ top: 0 });
  }, [current]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return;
      if (event.key === "ArrowLeft" && current > 0) {
        event.preventDefault();
        onStepChange(current - 1);
      }
      if (event.key === "ArrowRight" && current < steps.length - 1 && !nextDisabled) {
        event.preventDefault();
        onStepChange(current + 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, steps.length, nextDisabled, onStepChange]);

  return (
    <div className="flex flex-1 flex-col bg-background md:min-h-0 md:flex-row md:overflow-hidden md:rounded-lg md:border md:border-border">
      <nav
        ref={strip}
        aria-label={title}
        className="sticky top-0 z-10 flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-background px-4 py-3 md:static md:w-68 md:flex-col md:gap-1 md:overflow-y-auto md:border-r md:border-b-0 md:p-4"
      >
        <div className="hidden flex-col gap-0.5 pb-2 pl-3 md:flex">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </div>
        {steps.map((step, index) => (
          <StepperFormStep
            key={step.id}
            index={index}
            step={step}
            current={index === current}
            onSelect={() => onStepChange(index)}
          />
        ))}
      </nav>
      <div className="flex flex-1 flex-col md:min-h-0 md:min-w-0">
        <div ref={content} className="flex flex-1 flex-col md:min-h-0 md:overflow-y-auto">
          {children}
        </div>
        <div className="sticky bottom-0 flex shrink-0 flex-col items-center gap-2 border-t border-border bg-background px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:static md:flex-row md:justify-between md:px-6 md:py-3">
          <span className="text-sm font-medium text-muted-foreground md:order-2">{position}</span>
          <div className="flex w-full gap-3 md:contents">
            <Button
              variant="outline"
              size="lg"
              className="flex-1 md:order-1 md:h-8 md:flex-none md:px-3"
              disabled={!hasPrevious}
              onClick={() => onStepChange(current - 1)}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Button>
            <Button
              size="lg"
              className="flex-1 md:order-3 md:h-8 md:flex-none md:px-3"
              disabled={!hasNext}
              onClick={() => onStepChange(current + 1)}
            >
              Próximo
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
