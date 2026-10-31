import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OfflineBanner } from "./offline-banner";

describe("OfflineBanner", () => {
  it("aviso: Alert discreto que avisa sem bloquear", () => {
    render(<OfflineBanner type="aviso" />);

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Você está offline");
    expect(banner.textContent).toContain(
      "O que você registrar fica salvo neste aparelho e é enviado quando a conexão voltar.",
    );
    expect(banner.className).toContain("bg-warning-subtle");
  });

  it("bloqueio: cobre o conteúdo, diz que nada se perdeu e tenta de novo (frame 8 da #128)", async () => {
    const onRetry = vi.fn<() => void>();
    render(<OfflineBanner type="bloqueio" pending={12} onRetry={onRetry} />);

    expect(screen.getByRole("heading", { name: "Reconecte para continuar" })).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain(
      "Faz mais de 72 horas que este aparelho não confirma sua sessão. Nada foi apagado: as 12 alterações pendentes continuam salvas aqui.",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("bloqueio com uma pendência: singular", () => {
    render(<OfflineBanner type="bloqueio" pending={1} onRetry={() => {}} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Nada foi apagado: a alteração pendente continua salva aqui.",
    );
  });

  it("bloqueio sem pendências: só diz que nada foi apagado", () => {
    render(<OfflineBanner type="bloqueio" pending={0} onRetry={() => {}} />);

    expect(
      screen.getByText(
        "Faz mais de 72 horas que este aparelho não confirma sua sessão. Nada foi apagado.",
      ),
    ).toBeDefined();
  });
});
