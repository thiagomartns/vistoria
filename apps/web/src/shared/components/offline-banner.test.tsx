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

  it("bloqueio: cobre o conteúdo, diz que nada se perdeu e tenta de novo", async () => {
    const onRetry = vi.fn<() => void>();
    render(<OfflineBanner type="bloqueio" pending={12} onRetry={onRetry} />);

    expect(screen.getByRole("heading", { name: "Conexão necessária" })).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain(
      "Seus dados estão salvos neste dispositivo (12 alterações pendentes).",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("bloqueio com uma pendência: singular", () => {
    render(<OfflineBanner type="bloqueio" pending={1} onRetry={() => {}} />);

    expect(screen.getByRole("alert").textContent).toContain("(1 alteração pendente)");
  });
});
