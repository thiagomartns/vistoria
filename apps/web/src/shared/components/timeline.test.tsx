import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Timeline, TimelineItem } from "./timeline";

// A linha do tempo (Figma TimelineItem 231:1825): uma lista ordenada com um link por item, o marcador pelo estado e o
// que quem usa passar embaixo da meta.

describe("Timeline", () => {
  it("lista ordenada com um link por item, título e meta no nome, e o badge embaixo", () => {
    render(
      <Timeline label="Histórico do imóvel">
        <TimelineItem
          href="/a"
          title="Saída · Em andamento"
          meta="Iniciada em 19/10/2026"
          marker="hollow"
          badge={<span>Salvo no aparelho</span>}
        />
        <TimelineItem href="/b" title="Entrada · Concluída" marker="filled" />
      </Timeline>,
    );

    const list = screen.getByRole("list", { name: "Histórico do imóvel" });
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-marker"))).toEqual(["hollow", "filled"]);
    const first = within(items[0]!).getByRole("link");
    expect(first.getAttribute("href")).toBe("/a");
    expect(first.textContent).toBe("Saída · Em andamentoIniciada em 19/10/2026Salvo no aparelho");
    expect(within(items[1]!).getByRole("link").textContent).toBe("Entrada · Concluída");
  });

  it("apagado: o título fica no tom muted", () => {
    render(
      <Timeline label="h">
        <TimelineItem href="/a" title="Entrada · Em andamento" marker="muted" />
      </Timeline>,
    );

    expect(screen.getByText("Entrada · Em andamento").className).toContain("text-muted-foreground");
  });
});
