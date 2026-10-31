import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

describe("SessionExpired, outro usuário (frame 2 da #128)", () => {
  const otherUser = (over: Partial<Parameters<typeof SessionExpired>[0]["otherUser"]> = {}) => ({
    previousName: "Ana Souza",
    pending: 4,
    onCancel: vi.fn<() => void>(),
    onConfirm: vi.fn<() => void>(),
    ...over,
  });

  it("danger: cita o nome do anterior e o número de pendências", () => {
    render(<SessionExpired otherUser={otherUser()} />);

    const notice = screen.getByRole("alert");
    expect(notice.className).toContain("bg-danger-subtle");
    expect(notice.textContent).toContain("As alterações da outra conta serão apagadas");
    expect(notice.textContent).toContain(
      "Há 4 alterações de Ana Souza que ainda não foram enviadas. Ao entrar com outra conta, elas são apagadas deste aparelho.",
    );
  });

  it("com uma pendência, no singular", () => {
    render(<SessionExpired otherUser={otherUser({ pending: 1 })} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Há 1 alteração de Ana Souza que ainda não foi enviada. Ao entrar com outra conta, ela é apagada deste aparelho.",
    );
  });

  it("Cancelar e Apagar e entrar chamam cada um a sua decisão", async () => {
    const props = otherUser();
    render(<SessionExpired otherUser={props} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Apagar e entrar" }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it("enquanto a decisão sai, os botões ficam desabilitados", () => {
    render(<SessionExpired otherUser={otherUser({ busy: true })} />);

    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Apagar e entrar" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
