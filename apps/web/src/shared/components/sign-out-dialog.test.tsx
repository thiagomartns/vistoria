import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SIGN_OUT_TITLE, SignOutDialog } from "./sign-out-dialog";

describe("SignOutDialog", () => {
  const props = (over: Partial<Parameters<typeof SignOutDialog>[0]> = {}) => ({
    open: true,
    onOpenChange: vi.fn<(open: boolean) => void>(),
    pending: 3,
    offline: false,
    onConfirm: vi.fn<() => void>(),
    ...over,
  });

  it("com pendências: diz quantas se perdem e que não dá para desfazer (frame 4)", () => {
    render(<SignOutDialog {...props()} />);

    const dialog = screen.getByRole("dialog", { name: SIGN_OUT_TITLE });
    expect(dialog.textContent).toContain(
      "Há 3 alterações que ainda não foram enviadas. Ao sair, elas são apagadas deste aparelho e não dá para desfazer.",
    );
    expect(dialog.textContent).not.toContain("Sem rede");
  });

  it("offline: a frase a mais (frame 5)", () => {
    render(<SignOutDialog {...props({ offline: true })} />);

    expect(screen.getByRole("dialog").textContent).toContain(
      "Sem rede, elas não têm como ser enviadas agora: conecte-se e espere o envio para não perder nada.",
    );
  });

  it("com uma pendência, no singular", () => {
    render(<SignOutDialog {...props({ pending: 1, offline: true })} />);

    const text = screen.getByRole("dialog").textContent;
    expect(text).toContain("Há 1 alteração que ainda não foi enviada. Ao sair, ela é apagada");
    expect(text).toContain("Sem rede, ela não tem como ser enviada agora");
  });

  it("Cancelar fecha sem sair; Sair e apagar confirma", async () => {
    const p = props();
    render(<SignOutDialog {...p} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
    expect(p.onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sair e apagar" }));
    expect(p.onConfirm).toHaveBeenCalledOnce();
  });
});
