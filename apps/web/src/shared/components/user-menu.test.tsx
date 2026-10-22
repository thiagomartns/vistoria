import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserMenu, initialsOf } from "./user-menu";

describe("initialsOf", () => {
  it.each([
    ["Thiago Martins", "TM"],
    ["ana maria de souza", "AS"],
    ["Ana", "A"],
    ["  Élida   Prado ", "ÉP"],
  ])("%s → %s", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe("UserMenu", () => {
  it.each(["sidebar", "avatar"] as const)("%s: com sessão, mostra quem é e sai", async (layout) => {
    const onSignOut = vi.fn<() => void>();
    const user = userEvent.setup();
    render(
      <UserMenu
        user={{ name: "Thiago Martins" }}
        layout={layout}
        onSignOut={onSignOut}
        onSignIn={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByText("TM")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Menu do usuário" }));
    expect(screen.getByRole("menu").textContent).toContain("Thiago Martins");
    await user.click(screen.getByRole("menuitem", { name: "Sair" }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("sem sessão: ? e Entrar", async () => {
    const onSignIn = vi.fn<() => void>();
    const user = userEvent.setup();
    render(<UserMenu user={null} layout="sidebar" onSignOut={vi.fn<() => void>()} onSignIn={onSignIn} />);

    expect(screen.getByText("?")).toBeDefined();
    expect(screen.getByText("Sem sessão")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Menu do usuário" }));
    expect(screen.queryByRole("menuitem", { name: "Sair" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Entrar" }));

    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
