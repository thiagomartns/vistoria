# 0019 — Login da V1 com o pattern Auth do Sanjou

- **Status:** Aceito
- **Data:** 2026-10-16

## Contexto

O Sanjou UI tem um pattern Auth com quatro telas: Sign in (com "Lembrar-me" e "Esqueci a senha"), Create account, Forgot password e Verify email. A API da V1 só tem `signup`, `signin`, `refresh` e `signout` ([Autenticação](../architecture/backend.md#autenticação)), e a sessão precisa persistir para o app funcionar offline ([Segurança](../architecture/frontend.md#segurança)). O fluxo está desenhado no Figma (Fluxo 1 · Login, issue #6).

## Decisão

O login da V1 usa o pattern Auth do Sanjou com duas telas, Entrar (`/login`) e Criar conta (`/signup`). Ficam fora o "Lembrar-me", porque a sessão sempre persiste, e também a recuperação de senha e a verificação de e-mail.

## Consequências

As telas saem prontas do design system e não exigem endpoint novo nem envio de e-mail. Custo aceito: quem esquecer a senha não tem como recuperá-la sozinho na V1, e um cadastro com e-mail digitado errado só é percebido no próximo login. Recuperação de senha, quando vier, exige endpoints novos e um provedor de e-mail.
