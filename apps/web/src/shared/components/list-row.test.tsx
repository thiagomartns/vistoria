import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListRow } from "./list-row";
import { SyncBadge } from "./sync-badge";

describe("ListRow", () => {
  it("a linha inteira é o link, com título, subtítulo e o que vem à direita", () => {
    render(
      <ListRow
        href="/clients/edit?id=1"
        title="Maria Souza"
        subtitle="123.456.789-09 · (11) 98765-4321"
        trailing={<SyncBadge state="local" />}
      />,
    );

    const link = screen.getByRole("link", { name: /Maria Souza/ });
    expect(link.getAttribute("href")).toBe("/clients/edit?id=1");
    expect(link.textContent).toContain("123.456.789-09 · (11) 98765-4321");
    expect(link.textContent).toContain("Salvo no aparelho");
  });

  it("sem subtítulo, meta nem badges, só o título", () => {
    render(<ListRow href="/x" title="Lar Imóveis" />);

    expect(screen.getByRole("link").textContent).toBe("Lar Imóveis");
  });
});
