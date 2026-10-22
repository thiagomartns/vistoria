import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@sanjou/ui/form";
import { Input } from "@sanjou/ui/input";

import { AuthForm, type AuthFormProps } from "./auth-form";

// Figma "Auth form / Create account" (66:1962): nome, e-mail e senha; entra direto, sem verificação de e-mail (ADR 0019).

export type SignUpFormValues = { name: string; email: string; password: string };

export function SignUpForm(props: AuthFormProps<SignUpFormValues>) {
  const { control } = props.form;
  return (
    <AuthForm
      {...props}
      title="Criar conta"
      description="Preencha seus dados para começar."
      submitLabel="Criar conta"
      submittingLabel="Criando conta…"
      footer={{ text: "Já tem uma conta?", link: "Entrar", href: "/login" }}
    >
      <FormField
        control={control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nome</FormLabel>
            <FormControl>
              <Input autoComplete="name" placeholder="Seu nome completo" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
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
              <Input type="password" autoComplete="new-password" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </AuthForm>
  );
}
