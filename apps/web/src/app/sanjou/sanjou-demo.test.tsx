import { Button } from "@sanjou/ui/button";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SanjouDemo } from "./sanjou-demo";

describe("Sanjou UI", () => {
  it("renderiza um Button do pacote", () => {
    render(<Button>Salvar</Button>);

    expect(screen.getByRole("button", { name: "Salvar" })).toBeDefined();
  });

  it("abre o diálogo ao clicar no gatilho", async () => {
    const user = userEvent.setup();
    render(<SanjouDemo />);

    await user.click(screen.getByRole("button", { name: "Abrir diálogo" }));

    expect(screen.getByRole("dialog", { name: "Concluir vistoria" })).toBeDefined();
  });

  it("guarda o estado do Switch no cliente", async () => {
    const user = userEvent.setup();
    render(<SanjouDemo />);

    expect(screen.getByTestId("offline-state").textContent).toBe("Online");
    await user.click(screen.getByRole("switch", { name: "Modo offline" }));

    expect(screen.getByTestId("offline-state").textContent).toBe("Offline");
  });
});
