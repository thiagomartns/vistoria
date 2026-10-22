import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@sanjou/ui/form";
import { Input } from "@sanjou/ui/input";

import { AuthForm, type AuthFormProps } from "./auth-form";

// Figma "Auth form / Sign in" (66:907), sem "Lembrar-me" nem "Esqueci a senha" (ADR 0019).

export type SignInFormValues = { email: string; password: string };

export function SignInForm(props: AuthFormProps<SignInFormValues>) {
  const { control } = props.form;
  return (
    <AuthForm
      {...props}
      title="Entrar"
      description="Use o e-mail e a senha da sua conta."
      submitLabel="Entrar"
      submittingLabel="Entrando…"
      footer={{ text: "Não tem uma conta?", link: "Criar conta", href: "/signup" }}
    >
      <FormField
        control={control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>E-mail</FormLabel>
            <FormControl>
              <Input type="email" autoComplete="email" placeholder="voce@exemplo.com" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="password"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Senha</FormLabel>
            <FormControl>
              <Input type="password" autoComplete="current-password" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </AuthForm>
  );
}
