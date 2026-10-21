// Símbolo D1 "Anunciação" (docs/design/brand/): janela em arco atravessada por um feixe de luz, que
// entra sempre pelo alto à esquerda. Grade de 64 unidades; abaixo de 32 px, a versão reduzida tem
// traço mais grosso e feixe mais largo para não sumir.
const ARCH = "M14 60V28a18 18 0 0 1 36 0v32Z";
const BEAM = "M26 14 48 53.29V60H28.56L16.18 25.61A16 16 0 0 1 24.25 14Z";
const BEAM_SMALL = "M28 14 47 45.67V57H27.2L17 31.5V28A15 15 0 0 1 26.61 14Z";

type AvisMarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** Ao lado do nome "Avis", o símbolo não deve ser lido de novo. */
  decorative?: boolean;
};

export function AvisMark({
  size = 32,
  className,
  title = "Avis",
  decorative = false,
}: AvisMarkProps) {
  const small = size < 32;
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": title } as const);

  // Cores só por token do Sanjou: a luz é `brand` (`brand-text` no escuro) e o arco, `foreground`.
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      {...a11y}
    >
      <path d={small ? BEAM_SMALL : BEAM} className="fill-brand dark:fill-brand-text" />
      <path d={ARCH} strokeWidth={small ? 6 : 4} className="stroke-foreground" />
    </svg>
  );
}
