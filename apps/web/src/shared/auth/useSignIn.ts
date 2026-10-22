import { signInWithPassword } from "./session";
import { type SignInValues, signInErrors, signInSchema } from "./session.schemas";
import { useAuthForm } from "./useAuthForm";

/** O formulário de /login. */
export function useSignIn() {
  return useAuthForm<SignInValues>({
    schema: signInSchema,
    errors: signInErrors,
    defaultValues: { email: "", password: "" },
    submit: ({ email, password }) => signInWithPassword(email, password),
    fallback: "Não foi possível entrar agora. Tente de novo em instantes.",
  });
}
