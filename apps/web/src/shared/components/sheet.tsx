import { Button } from "@sanjou/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@sanjou/ui/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

// Painel que desliza sobre o conteúdo (Figma Sheet 12:1253), sobre o Dialog do Sanjou, que já traz o overlay,
// o foco preso e o Esc. Candidato ao Sanjou. lado: direita (drawer de 400px) | baixo (bottom sheet com alça) |
// auto (baixo no celular, direita a partir de md).

type SheetSide = "direita" | "baixo" | "auto";

const SIDE: Record<SheetSide, string> = {
  direita:
    "top-0 right-0 left-auto h-dvh max-w-[400px] translate-x-0 translate-y-0 rounded-none border-0 border-l sm:max-w-[400px]",
  baixo:
    "top-auto right-0 bottom-0 left-0 max-h-[85dvh] max-w-none translate-x-0 translate-y-0 rounded-none rounded-t-xl border-0 border-t sm:max-w-none",
  auto: "top-auto right-0 bottom-0 left-0 max-h-[85dvh] max-w-none translate-x-0 translate-y-0 rounded-none rounded-t-xl border-0 border-t sm:max-w-none md:top-0 md:left-auto md:h-dvh md:max-h-none md:max-w-[400px] md:rounded-none md:border-t-0 md:border-l",
};

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: SheetSide;
  title: string;
  description?: string;
  children: ReactNode;
};

export function Sheet({
  open,
  onOpenChange,
  side = "auto",
  title,
  description,
  children,
}: SheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={`flex w-full flex-col gap-0 overflow-y-auto p-0 shadow-lg ${SIDE[side]}`}
      >
        {side !== "direita" ? (
          <div
            className={`flex justify-center pt-2 ${side === "auto" ? "md:hidden" : ""}`}
            aria-hidden="true"
          >
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>
        ) : null}
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-left">
            <DialogTitle className="text-lg leading-7 font-semibold">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="Fechar">
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
