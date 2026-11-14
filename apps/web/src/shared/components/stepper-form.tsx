import { Button } from "@sanjou/ui/button";
import {
  Check,
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
// tela, não aqui. Na última etapa, `finish` troca Próximo pela ação de terminar ("Concluir vistoria", com Check). Candidato
// ao Sanjou. A coluna de etapas e o rodapé em linha não seguem a janela, e sim a largura do próprio formulário, pela
// variante `stepper-wide` (container query no container `stepper` que envolve tudo, no globals.css); quem está dentro
// dele usa a mesma variante (ADR 0061). Abaixo dela, a partir de 768 px de janela, o layout do celular fica dentro do
// card: a faixa em cima, o conteúdo rolando e a barra embaixo, sem nada preso sobre o padding do shell.

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
      className={`flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring stepper-wide:h-10 stepper-wide:w-full stepper-wide:gap-2 stepper-wide:rounded-md stepper-wide:border-0 ${
        current
          ? "border-2 border-primary bg-accent font-semibold"
          : "border border-border bg-background font-medium hover:bg-accent stepper-wide:bg-transparent"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${iconColor}`} aria-hidden="true" />
      <span className="text-foreground stepper-wide:min-w-0 stepper-wide:flex-1 stepper-wide:truncate stepper-wide:text-left">
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
  /** Próximo indisponível. */
  nextDisabled?: boolean;
  /** A ação da última etapa, no lugar de Próximo. Sem ela, Próximo fica desabilitado na última etapa. */
  finish?: { label: string; onClick: () => void };
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
  finish,
  children,
}: StepperFormProps) {
  const strip = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hasPrevious = current > 0;
  const hasNext = current < steps.length - 1 && !nextDisabled;
  const finishing = finish !== undefined && current === steps.length - 1;

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
    <div className="@container/stepper flex flex-1 flex-col md:min-h-0">
      <div className="flex flex-1 flex-col bg-background md:min-h-0 md:overflow-hidden md:rounded-lg md:border md:border-border stepper-wide:flex-row">
        <nav
          ref={strip}
          aria-label={title}
          className="sticky top-0 z-10 flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-background px-4 py-3 md:static stepper-wide:w-68 stepper-wide:flex-col stepper-wide:gap-1 stepper-wide:overflow-y-auto stepper-wide:border-r stepper-wide:border-b-0 stepper-wide:p-4"
        >
          <div className="hidden flex-col gap-0.5 pb-2 pl-3 stepper-wide:flex">
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
          <div
            ref={content}
            className="flex flex-1 flex-col md:min-h-0 md:overflow-y-auto"
          >
            {children}
          </div>
          <div className="sticky bottom-0 flex shrink-0 flex-col items-center gap-2 border-t border-border bg-background px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:static stepper-wide:flex-row stepper-wide:justify-between stepper-wide:px-6 stepper-wide:py-3">
            <span className="text-sm font-medium text-muted-foreground stepper-wide:order-2">
              {position}
            </span>
            <div className="flex w-full gap-3 stepper-wide:contents">
              <Button
                variant="outline"
                size="lg"
                className="flex-1 stepper-wide:order-1 stepper-wide:h-8 stepper-wide:flex-none stepper-wide:px-3"
                disabled={!hasPrevious}
                onClick={() => onStepChange(current - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Anterior
              </Button>
              {finishing ? (
                <Button
                  size="lg"
                  className="flex-1 stepper-wide:order-3 stepper-wide:h-8 stepper-wide:flex-none stepper-wide:px-3"
                  onClick={finish.onClick}
                >
                  {finish.label}
                  <Check aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="flex-1 stepper-wide:order-3 stepper-wide:h-8 stepper-wide:flex-none stepper-wide:px-3"
                  disabled={!hasNext}
                  onClick={() => onStepChange(current + 1)}
                >
                  Próximo
                  <ChevronRight aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
