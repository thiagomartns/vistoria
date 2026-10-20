// Gera a senha do SQL Server local em infra/.env e grava a connection string nos User Secrets da API.
// A senha nunca é impressa nem passa por argumento de processo: vai por arquivo (0600) e por stdin.
//
//   pnpm db:init            cria a senha se infra/.env não tiver uma; sempre regrava o User Secret
//   pnpm db:init --rotate   troca a senha; com o banco rodando, aplica no SQL Server sem perder dados
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PASSWORD_KEY,
  connectionString,
  generatePassword,
  parseArgs,
  readEnvValue,
  upsertEnvValue,
} from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const envPath = join(root, "infra", ".env");
const examplePath = join(root, "infra", ".env.example");
const composePath = join(root, "infra", "docker-compose.dev.yml");
const apiProject = join(root, "apps", "api", "Vistoria.Api");
const container = "vistoria-db";
const volume = "vistoria-dev_sqldata";

function succeeds(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function containerRunning() {
  try {
    const state = execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", container], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return state.trim() === "true";
  } catch {
    return false;
  }
}

// A senha atual vem do ambiente do próprio container; a nova, pelo stdin do sqlcmd.
function alterSaPassword(password) {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "sh",
      "-c",
      'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b',
    ],
    { input: `ALTER LOGIN sa WITH PASSWORD = N'${password}';\nGO\n`, stdio: ["pipe", "ignore", "inherit"] },
  );
}

function setUserSecret(password) {
  const secrets = { ConnectionStrings: { Default: connectionString(password) } };
  execFileSync("dotnet", ["user-secrets", "set", "--project", apiProject], {
    input: JSON.stringify(secrets),
    stdio: ["pipe", "ignore", "inherit"],
  });
}

function fail(message) {
  console.error(`db:init: ${message}`);
  process.exit(1);
}

const { rotate } = parseArgs(process.argv.slice(2));
const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(examplePath, "utf8");
let password = readEnvValue(envText, PASSWORD_KEY);

if (password === "" || rotate) {
  const running = containerRunning();
  const volumeExists = succeeds("docker", ["volume", "inspect", volume]);

  // O SQL Server só lê MSSQL_SA_PASSWORD ao criar o volume; depois, a senha só muda com ALTER LOGIN.
  if (volumeExists && !running) {
    fail(
      password === ""
        ? `o volume ${volume} já existe, mas infra/.env não tem a senha dele. Recupere a senha antiga ` +
            `ou recrie o banco local (apaga os dados): pnpm db:down && docker volume rm ${volume}`
        : "para trocar a senha, suba o banco antes (pnpm db:up) e rode de novo.",
    );
  }

  const next = generatePassword();
  if (running) {
    alterSaPassword(next);
  }
  writeFileSync(envPath, upsertEnvValue(envText, PASSWORD_KEY, next));
  chmodSync(envPath, 0o600); // o mode do writeFileSync só vale para arquivo novo
  if (running) {
    // Recria o container com a variável nova (o healthcheck a usa); o volume e os dados ficam.
    execFileSync("docker", ["compose", "-f", composePath, "up", "-d", "--wait"], { stdio: "inherit" });
  }
  password = next;
  console.log(`db:init: senha ${running ? "trocada no SQL Server e " : ""}gravada em infra/.env.`);
}

setUserSecret(password);
console.log("db:init: ConnectionStrings:Default gravada nos User Secrets da API.");
