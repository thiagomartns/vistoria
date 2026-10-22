import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionExpired } from "./session-expired";

describe("SessionExpired", () => {
  it("com pendências: warning, diz quantas esperam e que nada se perdeu", () => {
    render(<SessionExpired pending={4} />);

    const notice = screen.getByRole("status");
    expect(notice.className).toContain("bg-warning-subtle");
    expect(notice.textContent).toContain("Sua sessão expirou");
    expect(notice.textContent).toContain(
      "Entre novamente para enviar as 4 alterações salvas neste aparelho. Nada foi perdido.",
    );
  });

  it("com uma pendência, no singular", () => {
    render(<SessionExpired pending={1} />);

    expect(screen.getByRole("status").textContent).toContain(
      "Entre novamente para enviar a alteração salva neste aparelho.",
    );
  });

  it("sem pendências: neutro, só pede o login", () => {
    render(<SessionExpired pending={0} />);

    const notice = screen.getByRole("status");
    expect(notice.className).toContain("bg-card");
    expect(notice.textContent).toContain("Entre novamente para continuar.");
  });
});
