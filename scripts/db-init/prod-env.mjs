// `pnpm prod:init`: gera o infra/.env.prod do docker-compose de produção, com a senha do SQL Server e a chave do JWT.
// Nada é impresso nem passa por argumento: o arquivo nasce com permissão 0600. Se ele já existe, fica como está (a
// senha já está no volume do banco; trocar é outra operação). No GitHub Actions, os valores são mascarados antes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { PASSWORD_KEY, PROD_JWT_KEY, prodEnv, readEnvValue } from "./lib.mjs";

const path = join(resolve(import.meta.dirname, "../.."), "infra", ".env.prod");

if (existsSync(path)) {
  console.log("prod:init: infra/.env.prod já existe; nada mudou.");
} else {
  writeFileSync(path, prodEnv(), { mode: 0o600, flag: "wx" });
  console.log(`prod:init: infra/.env.prod criado (0600) com ${PASSWORD_KEY} e ${PROD_JWT_KEY}.`);
}

if (process.env.GITHUB_ACTIONS === "true") {
  const text = readFileSync(path, "utf8");
  for (const key of [PASSWORD_KEY, PROD_JWT_KEY])
    console.log(`::add-mask::${readEnvValue(text, key)}`);
}
