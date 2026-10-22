import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signUp } from "@/shared/api/generated";
import { resetSession, sessionStore } from "@/shared/auth/session";

import { SignUpScreen } from "./sign-up-screen";

const navigation = vi.hoisted(() => ({ replace: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn<() => void>() }),
}));

vi.mock("@/shared/api/generated", async (original) => ({
  ...(await original<typeof import("@/shared/api/generated")>()),
  signUp: vi.fn<() => unknown>(),
}));

const owner = { id: "0199a0b2-7c1e-7f3a-9b2d-1c2d3e4f5a6b", name: "Ana Souza" };

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome"), "Ana Souza");
  await user.type(screen.getByLabelText("E-mail"), "ana@exemplo.com");
  await user.type(screen.getByLabelText("Senha"), "senha-longa");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));
}

afterEach(() => {
  resetSession();
  localStorage.clear();
  vi.mocked(signUp).mockReset();
  navigation.replace.mockReset();
});

describe("/signup", () => {
  it("o formulário do Figma e o link para entrar", () => {
    render(<SignUpScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "Criar conta" })).toBeDefined();
    expect(screen.getByText("Preencha seus dados para começar.")).toBeDefined();
    expect(screen.getByLabelText("Nome").getAttribute("placeholder")).toBe("Seu nome completo");
    expect(screen.getByRole("link", { name: "Entrar" }).getAttribute("href")).toBe("/login");
  });

  it("valida os tamanhos do contrato antes de enviar", async () => {
    render(<SignUpScreen />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Nome"), "A");
    await user.type(screen.getByLabelText("E-mail"), "ana");
    await user.type(screen.getByLabelText("Senha"), "curta");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByText("O nome precisa ter de 2 a 120 caracteres.")).toBeDefined();
    expect(screen.getByText("Informe um e-mail válido.")).toBeDefined();
    expect(screen.getByText("A senha precisa ter de 8 a 128 caracteres.")).toBeDefined();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("e-mail já cadastrado: a mensagem da API no campo E-mail", async () => {
    vi.mocked(signUp).mockResolvedValue({
      error: {
        type: "urn:vistoria:problem:validation",
        title: "Dados inválidos",
        status: 400,
        detail: "Um ou mais campos são inválidos.",
        traceId: "00-trace",
        errors: { email: ["E-mail já cadastrado."] },
      },
      response: new Response(null, { status: 400 }),
    } as never);
    render(<SignUpScreen />);

    await fillAndSubmit();

    expect(await screen.findByText("E-mail já cadastrado.")).toBeDefined();
    expect(screen.getByLabelText("E-mail").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("criou: entra e vai para o shell", async () => {
    vi.mocked(signUp).mockResolvedValue({
      data: { accessToken: "token", expiresAt: "2026-10-22T15:00:00Z", user: owner },
    } as never);
    render(<SignUpScreen />);

    await fillAndSubmit();

    await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/inspections"));
    expect(sessionStore.getSnapshot()).toMatchObject({ status: "active", user: owner });
  });
});
