import { Button } from "@sanjou/ui/button";
import { Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { FieldSyncIndicator, type FieldSyncState } from "./field-sync-indicator";

// Item do ambiente na tela de campo (Figma InspectionItem 42:1758), tipo entrada. No desktop, o nome e o
// FieldSyncIndicator numa coluna de 220 px ao lado da avaliação; no celular, o nome e o indicador numa linha e a
// avaliação embaixo, em largura cheia. A avaliação é o ToggleGroup de condição (quem usa passa), o erro do servidor e a
// observação sob demanda: "Adicionar observação" abre o campo, e com texto ele já vem aberto. Somente leitura (envio
// em voo) esconde o botão. A saída ("Na entrada") chega no M5. Específico do vistoria (ADR 0020).

type InspectionItemProps = {
  name: string;
  /** Estado de sync do item; sem ele, nada (silêncio no caminho feliz). */
  sync?: FieldSyncState;
  /** O ToggleGroup de condição. */
  condition: ReactNode;
  /** A mensagem de erro do campo (FormMessage), quando houver. */
  error?: ReactNode;
  /** O campo da observação (Textarea). */
  notes: ReactNode;
  /** A observação tem texto: o campo já aparece aberto. */
  hasNotes: boolean;
  readOnly?: boolean;
};

export function InspectionItem({
  name,
  sync,
  condition,
  error,
  notes,
  hasNotes,
  readOnly = false,
}: InspectionItemProps) {
  const [opened, setOpened] = useState(false);
  const notesBox = useRef<HTMLDivElement>(null);
  const open = hasNotes || opened;

  // Aberta pelo botão, a observação recebe o foco: o próximo toque já é digitar.
  useEffect(() => {
    if (opened) notesBox.current?.querySelector("textarea")?.focus();
  }, [opened]);

  return (
    <div className="flex flex-col gap-2 border-b border-border py-4 md:flex-row md:gap-4">
      <div className="flex items-center gap-2 md:w-55 md:shrink-0 md:flex-col md:items-start md:gap-1 md:pt-1">
        <span className="min-w-0 flex-1 text-base font-semibold text-foreground md:flex-none md:font-medium">
          {name}
        </span>
        {sync ? <FieldSyncIndicator state={sync} /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        {condition}
        {error}
        {open ? (
          <div ref={notesBox} className="w-full">
            {notes}
          </div>
        ) : readOnly ? null : (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="md:h-7 md:px-2.5 md:text-sm"
            aria-label={`Adicionar observação: ${name}`}
            onClick={() => setOpened(true)}
          >
            <Plus aria-hidden="true" />
            Adicionar observação
          </Button>
        )}
      </div>
    </div>
  );
}
