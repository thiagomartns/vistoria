import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `globals`, o Testing Library não desmonta sozinho entre os testes.
afterEach(() => {
  cleanup();
});

// O Select do Radix usa captura de ponteiro e rola até o item escolhido; o jsdom não implementa nenhum dos dois.
// Os testes com `@vitest-environment node` não têm DOM.
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
