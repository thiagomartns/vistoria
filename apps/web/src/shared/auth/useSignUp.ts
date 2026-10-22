import { signUpWithPassword } from "./session";
import { type SignUpValues, signUpErrors, signUpSchema } from "./session.schemas";
import { useAuthForm } from "./useAuthForm";

/** O formulário de /signup. */
export function useSignUp() {
  return useAuthForm<SignUpValues>({
    schema: signUpSchema,
    errors: signUpErrors,
    defaultValues: { name: "", email: "", password: "" },
    submit: ({ name, email, password }) => signUpWithPassword(name, email, password),
    fallback: "Não foi possível criar a conta agora. Tente de novo em instantes.",
  });
}
