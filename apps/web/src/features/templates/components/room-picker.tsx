import { Button } from "@sanjou/ui/button";
import { Separator } from "@sanjou/ui/separator";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { Sheet } from "@/shared/components/sheet";

// "Adicionar ambientes" no editor de roteiro (Figma "Ambientes prontos (#200)"): o Sheet de baixo no celular e à
// direita a partir de md. "Ambiente vazio" faz o que o botão fazia antes; os prontos têm um contador − n + cada, e o
// mesmo pode entrar mais de uma vez. Os + desabilitam quando a soma chega ao que cabe no roteiro, e o botão do rodapé
// desabilita sem nada escolhido. A escolha é só da tela: some ao fechar.

type RoomPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Os ambientes prontos, na ordem do catálogo. */
  rooms: { name: string; detail: string }[];
  /** Quantos ambientes ainda cabem no roteiro. */
  left: number;
  /** O limite do roteiro (o aviso "O roteiro pode ter até 40 ambientes."). */
  max: number;
  onEmpty: () => void;
  onAdd: (choices: { name: string; count: number }[]) => void;
};

export function RoomPicker({
  open,
  onOpenChange,
  rooms,
  left,
  max,
  onEmpty,
  onAdd,
}: RoomPickerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar ambientes"
      description={`Escolha quantos de cada. ${left === 1 ? "Cabe mais 1" : `Cabem mais ${left}`} neste roteiro.`}
    >
      <Choices rooms={rooms} left={left} max={max} onEmpty={onEmpty} onAdd={onAdd} />
    </Sheet>
  );
}

const chosenLabel = (total: number) =>
  total === 0 ? "Nenhum escolhido" : `${total} ${total === 1 ? "escolhido" : "escolhidos"}`;

const addLabel = (total: number) =>
  total === 0
    ? "Adicionar ambientes"
    : `Adicionar ${total} ${total === 1 ? "ambiente" : "ambientes"}`;

// Dentro do Sheet: o conteúdo sai da tela ao fechar, e a escolha recomeça do zero na próxima vez.
function Choices({
  rooms,
  left,
  max,
  onEmpty,
  onAdd,
}: Omit<RoomPickerProps, "open" | "onOpenChange">) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const full = total >= left;
  const change = (name: string, delta: number) =>
    setCounts((current) => ({ ...current, [name]: Math.max(0, (current[name] ?? 0) + delta) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 px-5">
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={onEmpty}>
          Ambiente vazio
        </Button>
        <Separator />
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Ambientes prontos</h3>
          <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {chosenLabel(total)}
          </span>
        </div>
      </div>
      <ul
        aria-label="Ambientes prontos"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-5 py-2"
      >
        {rooms.map((room) => {
          const count = counts[room.name] ?? 0;
          return (
            <li key={room.name} className="flex items-center gap-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{room.name}</span>
                <span className="truncate text-xs text-muted-foreground">{room.detail}</span>
              </span>
              <span
                role="group"
                aria-label={room.name}
                className="flex shrink-0 items-center gap-2"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Tirar ${room.name}`}
                  disabled={count === 0}
                  onClick={() => change(room.name, -1)}
                >
                  <Minus aria-hidden="true" />
                </Button>
                <span
                  className={`w-5 text-center text-sm tabular-nums ${count > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                >
                  {count}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Somar ${room.name}`}
                  disabled={full}
                  onClick={() => change(room.name, 1)}
                >
                  <Plus aria-hidden="true" />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 px-5 pt-2 pb-5">
        {full && total > 0 ? (
          <p className="text-sm text-muted-foreground">O roteiro pode ter até {max} ambientes.</p>
        ) : null}
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={total === 0}
          onClick={() => onAdd(Object.entries(counts).map(([name, count]) => ({ name, count })))}
        >
          {addLabel(total)}
        </Button>
      </div>
    </div>
  );
}
