import { Button } from "@sanjou/ui/button";
import { render, screen } from "@testing-library/react";
import { Building2 } from "lucide-react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("título, descrição e a ação", () => {
    render(
      <EmptyState
        icon={Building2}
        title="Nenhum cliente ainda"
        description="Cadastre o primeiro."
        action={<Button>Novo cliente</Button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Nenhum cliente ainda" })).toBeDefined();
    expect(screen.getByText("Cadastre o primeiro.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Novo cliente" })).toBeDefined();
  });

  it("sem ação", () => {
    render(<EmptyState icon={Building2} title="Nada" description="Sem resultados." />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
