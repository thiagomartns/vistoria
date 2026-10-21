import { AvisMark } from "./avis-mark";

// Assinatura da marca (docs/design/brand/). Proporções do guia, com o nome em 20 px: no horizontal, o
// símbolo tem 1,4× o corpo e o vão 0,4×; no vertical, 2,1× e 0,44×. A área de proteção (metade da
// largura do símbolo) fica por conta de quem usa.
type AvisLockupProps = {
  layout: "horizontal" | "vertical";
  /** Legenda "Vistoria de imóveis" (`legenda` no Figma). */
  caption?: boolean;
  className?: string;
};

export function AvisLockup({ layout, caption = false, className }: AvisLockupProps) {
  const horizontal = layout === "horizontal";
  const root = horizontal
    ? "inline-flex items-center gap-2"
    : "inline-flex flex-col items-center gap-[9px] text-center";

  // O nome é texto de verdade ("Avis", em caixa-alta só no CSS), então o símbolo é decorativo e o
  // leitor de tela lê "Avis" uma vez.
  return (
    <span className={className ? `${root} ${className}` : root}>
      <AvisMark size={horizontal ? 28 : 42} decorative />
      <span className="flex flex-col">
        <span className="text-xl font-normal tracking-[0.14em] text-foreground uppercase">
          Avis
        </span>
        {caption ? (
          <span
            className={`font-medium text-muted-foreground ${horizontal ? "text-xs" : "text-sm"}`}
          >
            Vistoria de imóveis
          </span>
        ) : null}
      </span>
    </span>
  );
}
