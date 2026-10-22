import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthLayout } from "./auth-layout";

describe("AuthLayout", () => {
  it("formulário no main; o painel da marca é decorativo e só aparece a partir de 1024 px", () => {
    const { container } = render(<AuthLayout>formulário</AuthLayout>);

    expect(screen.getByRole("main").textContent).toBe("formulário");
    const panel = container.querySelector('[aria-hidden="true"]');
    expect(panel?.className).toContain("hidden");
    expect(panel?.className).toContain("lg:flex");
    expect(panel?.className).toContain("bg-gray-12");
    expect(panel?.querySelector(".dark svg")).not.toBeNull();
  });
});
