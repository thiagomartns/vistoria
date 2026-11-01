// `node scripts/db-init/ci-env.mjs`: no job `e2e` do CI, gera a senha do SQL Server, a chave do JWT e a senha do
// usuário de dev desta execução e as grava no $GITHUB_ENV, com os nomes que o container, a API e o `pnpm seed` leem.
// Nada fica literal no workflow (ADR 0025), e todas são mascaradas antes de qualquer passo seguinte poder imprimi-las.

import { appendFileSync } from "node:fs";

import { PASSWORD_KEY as DEV_USER_PASSWORD_KEY } from "../seed/lib.mjs";
import { PASSWORD_KEY, connectionString, generateJwtKey, generatePassword } from "./lib.mjs";

const target = process.env.GITHUB_ENV;
if (!target) {
  console.error("ci-env: só no GitHub Actions ($GITHUB_ENV não existe). Em dev, rode pnpm db:init.");
  process.exit(1);
}

const password = generatePassword();
const jwtKey = generateJwtKey();
const devUserPassword = generatePassword();
for (const value of [password, connectionString(password), jwtKey, devUserPassword]) {
  console.log(`::add-mask::${value}`);
}
appendFileSync(
  target,
  [
    `${PASSWORD_KEY}=${password}`,
    `ConnectionStrings__Default=${connectionString(password)}`,
    `Jwt__SigningKey=${jwtKey}`,
    `${DEV_USER_PASSWORD_KEY}=${devUserPassword}`,
    "",
  ].join("\n"),
);
const names = `${PASSWORD_KEY}, ConnectionStrings__Default, Jwt__SigningKey e ${DEV_USER_PASSWORD_KEY}`;
console.log(`ci-env: ${names} no $GITHUB_ENV.`);
