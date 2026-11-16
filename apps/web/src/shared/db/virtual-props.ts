// As props virtuais do TanStack DB (`$hasPendingWrites`, `$origin`, `$key`, `$collectionId`) vêm em toda linha que a
// collection devolve (`get`, live query). Elas descrevem a memória da hora da leitura e nunca saem dela: nem para o
// rascunho, nem para a fila, nem para a store confirmada. Uma que fosse gravada valeria para sempre, porque o TanStack DB
// prefere a prop que a linha já traz à que ele calcula (#211). Nenhum campo de registro começa com `$`.

/** `row` sem as props virtuais do TanStack DB: as chaves de topo que começam com `$`. */
export function withoutVirtualProps<T extends object>(row: T): T {
  if (!Object.keys(row).some((key) => key.startsWith("$"))) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("$"))) as T;
}
