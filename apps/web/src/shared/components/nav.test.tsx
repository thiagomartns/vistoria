import { render, screen, within } from "@testing-library/react";
import { Building2, ClipboardList } from "lucide-react";
import { describe, expect, it } from "vitest";

import { BottomNav, Sidebar } from "./nav";

const items = [
  { href: "/inspections", label: "Vistorias", icon: ClipboardList },
  { href: "/clients", label: "Clientes", icon: Building2 },
];

describe("Sidebar", () => {
  it("marca, links e o rodapé, com o item da rota marcado como página atual", () => {
    render(<Sidebar items={items} activeHref="/clients" footer={<p>rodapé</p>} />);

    expect(screen.getByText("Avis")).toBeDefined();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const active = within(nav).getByRole("link", { name: "Clientes" });
    expect(active.getAttribute("href")).toBe("/clients");
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toContain("bg-accent");
    expect(
      within(nav).getByRole("link", { name: "Vistorias" }).getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.getByText("rodapé")).toBeDefined();
  });
});

describe("BottomNav", () => {
  it("o ativo usa o indicador com fundo e o rótulo forte, não só cor", () => {
    render(<BottomNav items={items} activeHref="/inspections" />);

    const active = screen.getByRole("link", { name: "Vistorias" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.querySelector("span")?.className).toContain("bg-accent");
    expect(within(active).getByText("Vistorias").className).toContain("font-semibold");
    expect(
      within(screen.getByRole("link", { name: "Clientes" })).getByText("Clientes").className,
    ).toContain("font-medium");
  });
});
