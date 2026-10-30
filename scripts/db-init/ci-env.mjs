// `node scripts/db-init/ci-env.mjs`: no job `e2e` do CI, gera a senha do SQL Server e a chave do JWT desta execução e
// as grava no $GITHUB_ENV, com os nomes que o container e a API leem. Nada fica literal no workflow (ADR 0025), e as
// duas são mascaradas antes de qualquer passo seguinte poder imprimi-las.

import { appendFileSync } from "node:fs";

import { PASSWORD_KEY, connectionString, generateJwtKey, generatePassword } from "./lib.mjs";

const target = process.env.GITHUB_ENV;
if (!target) {
  console.error("ci-env: só no GitHub Actions ($GITHUB_ENV não existe). Em dev, rode pnpm db:init.");
  process.exit(1);
}

const password = generatePassword();
const jwtKey = generateJwtKey();
for (const value of [password, connectionString(password), jwtKey]) console.log(`::add-mask::${value}`);
appendFileSync(
  target,
  [
    `${PASSWORD_KEY}=${password}`,
    `ConnectionStrings__Default=${connectionString(password)}`,
    `Jwt__SigningKey=${jwtKey}`,
    "",
  ].join("\n"),
);
console.log(`ci-env: ${PASSWORD_KEY}, ConnectionStrings__Default e Jwt__SigningKey no $GITHUB_ENV.`);
