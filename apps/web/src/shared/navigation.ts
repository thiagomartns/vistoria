// Navegação com recarga completa, fora do router do Next. O "Sair" termina assim: a página nova não herda conexão de
// IndexedDB, token nem estado em memória do usuário que saiu, e o `deleteDatabase` que uma conexão segurava conclui.

export function reloadAt(href: string): void {
  window.location.replace(href);
}
