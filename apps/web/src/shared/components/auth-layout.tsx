import type { ReactNode } from "react";

import { AvisMark } from "./avis-mark";

// Pattern Auth do Sanjou (Figma "Auth layout" 66:849, ADR 0019): painel da marca à esquerda e formulário à direita
// (clamp(24rem, 25%, 32rem)); abaixo de 1024 px, só o formulário, com o conteúdo em até 384. No lugar da imagem,
// o painel escuro do ícone do app (docs/design/brand/app-icon.svg): fundo gray-12, arco claro e luz indigo-11,
// porque o índigo não é fundo da marca nas telas do produto.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <div
        aria-hidden="true"
        className="hidden flex-1 items-center justify-center bg-gray-12 lg:flex dark:bg-gray-2"
      >
        {/* O `.dark` só em volta do símbolo: arco em foreground escuro (claro) e luz em brand-text. */}
        <span className="dark">
          <AvisMark size={160} decorative />
        </span>
      </div>
      <main className="flex w-full flex-col items-center justify-center bg-background px-4 py-8 lg:w-[clamp(24rem,25%,32rem)] lg:shrink-0 lg:p-8">
        <div className="w-full max-w-96">{children}</div>
      </main>
    </div>
  );
}
