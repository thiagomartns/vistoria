import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SortableItem } from "./sortable-item";

describe("SortableItem", () => {
  it("a alça é um botão com o nome acessível e recebe os atributos e listeners do arrasto", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn<() => void>();
    render(
      <ul>
        <SortableItem
          handleLabel="Mover Sala"
          handleProps={{ "aria-roledescription": "item reordenável", onKeyDown }}
        >
          <span>Sala</span>
        </SortableItem>
      </ul>,
    );

    const handle = screen.getByRole("button", { name: "Mover Sala" });
    expect(handle.getAttribute("aria-roledescription")).toBe("item reordenável");
    expect(handle.className).toContain("touch-none");
    handle.focus();
    await user.keyboard(" ");
    expect(onKeyDown).toHaveBeenCalled();
    expect(screen.getByRole("listitem").textContent).toBe("Sala");
  });

  it("padrão, selecionado e levantado (com sombra)", () => {
    const { rerender } = render(
      <ul>
        <SortableItem handleLabel="Mover Piso">Piso</SortableItem>
      </ul>,
    );
    const row = () => screen.getByRole("listitem");
    expect(row().dataset.selected).toBe("false");
    expect(row().className).toContain("bg-background");

    rerender(
      <ul>
        <SortableItem handleLabel="Mover Piso" selected>
          Piso
        </SortableItem>
      </ul>,
    );
    expect(row().dataset.selected).toBe("true");
    expect(row().className).toContain("bg-muted");
    expect(row().className).not.toContain("shadow-md");

    rerender(
      <ul>
        <SortableItem handleLabel="Mover Piso" dragging>
          Piso
        </SortableItem>
      </ul>,
    );
    expect(row().className).toContain("shadow-md");
  });
});
