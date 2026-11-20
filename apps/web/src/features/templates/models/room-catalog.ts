/** Um ambiente como molde: o nome e os itens, na ordem em que o roteiro ou a vistoria os recebe. */
export interface RoomMold {
  name: string;
  items: readonly { name: string }[];
}

const mold = (name: string, items: readonly string[]): RoomMold => ({
  name,
  items: items.map((item) => ({ name: item })),
});

/**
 * Os ambientes prontos (#200): a fonte única dos ambientes comuns, com os itens mais comuns de cada um. O editor de
 * roteiro os oferece em "Adicionar ambiente", e o roteiro padrão embutido (`DEFAULT_TEMPLATE`, da entrada num aparelho
 * sem roteiro) é montado daqui. É uma constante do app: não é gravada no banco local nem enviada.
 */
export const ROOM_CATALOG: readonly RoomMold[] = [
  mold("Sala", [
    "Piso",
    "Paredes",
    "Teto",
    "Portas",
    "Janelas",
    "Iluminação",
    "Tomadas e interruptores",
  ]),
  mold("Cozinha", [
    "Piso",
    "Paredes",
    "Teto",
    "Pia e torneira",
    "Armários",
    "Tomadas e interruptores",
  ]),
  mold("Quarto", ["Piso", "Paredes", "Teto", "Porta", "Janela", "Armário"]),
  mold("Banheiro", [
    "Piso",
    "Paredes",
    "Teto",
    "Vaso sanitário",
    "Pia e torneira",
    "Box e chuveiro",
  ]),
  mold("Lavabo", ["Piso", "Paredes", "Teto", "Vaso sanitário", "Pia e torneira"]),
  mold("Área de serviço", ["Piso", "Paredes", "Tanque", "Torneira"]),
  mold("Varanda", ["Piso", "Paredes", "Teto", "Guarda-corpo", "Porta"]),
  mold("Hall de entrada", ["Piso", "Paredes", "Teto", "Porta de entrada", "Iluminação"]),
  mold("Escritório", ["Piso", "Paredes", "Teto", "Porta", "Janela", "Tomadas e interruptores"]),
  mold("Garagem", ["Piso", "Paredes", "Portão", "Iluminação"]),
];

/** O ambiente pronto com esse nome; um nome fora do catálogo é erro de programação. */
export function catalogRoom(name: string): RoomMold {
  const room = ROOM_CATALOG.find((candidate) => candidate.name === name);
  if (!room) throw new Error(`Ambiente fora do catálogo: ${name}`);
  return room;
}
