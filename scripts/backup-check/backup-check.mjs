// `pnpm backup:check`
// Restaura o backup do compose de produção num SQL Server limpo e confere as contagens (#196, ADR 0070). Exige
// `pnpm prod:init` e o compose de produção no ar, com dados (no CI, depois do `spike:v1` e do `smoke:prod`).
//
// 1. Um backup de log agora, pelo serviço `backup`: com o full que ele fez ao subir, a restauração passa pela cadeia.
// 2. As contagens por tabela da origem.
// 3. Um SQL Server novo, sem rede, com o volume dos backups só leitura; a senha dele é gerada aqui e vai pelo ambiente
//    do `docker run` (-e NOME, sem o valor no argumento).
// 4. O `backup.sh restore` nele: o último full, os logs depois dele, o RECOVERY e o DBCC CHECKDB.
// 5. As contagens da restauração, iguais às da origem, com usuários e vistorias.
// 6. A senha do banco não aparece no log do backup.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { generatePassword, PASSWORD_KEY, readEnvValue } from "../db-init/lib.mjs";
import { backupVolume, compareCounts, parseCounts } from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const compose = ["compose", "-f", "infra/docker-compose.prod.yml", "--env-file", "infra/.env.prod"];
// 127.0.0.1, não localhost: sem rede (--network none), o ODBC não resolve o nome.
const sqlcmdReady = '/opt/mssql-tools18/bin/sqlcmd -S 127.0.0.1 -U sa -C -Q "SELECT 1" -b -o /dev/null';

const step = (n, text) => console.log(`\n${n}. ${text}`);
const ok = (text) => console.log(`   ✓ ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(args, { env = {}, check = true } = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (check && result.status !== 0) {
    throw new Error(`docker ${args.slice(0, 4).join(" ")} … saiu com ${result.status}\n${result.stdout}${result.stderr}`);
  }
  return result;
}

const indent = (text) => text.trim().split("\n").map((line) => `   ${line}`).join("\n");

const prodPassword = readEnvValue(readFileSync(`${root}infra/.env.prod`, "utf8"), PASSWORD_KEY);
if (prodPassword === "") {
  throw new Error("infra/.env.prod sem a senha do banco: rode pnpm prod:init e suba o compose de produção");
}

const clean = `vistoria-backup-check-${randomBytes(3).toString("hex")}`;
let failed = false;

try {
  step(1, "Backup de log agora, pelo serviço backup");
  console.log(indent(docker([...compose, "exec", "-T", "backup", "bash", "/backup/backup.sh", "log"]).stdout));
  const plan = docker([...compose, "exec", "-T", "backup", "bash", "/backup/backup.sh", "plan"]).stdout.trim().split("\n");
  ok(`restauração por ${plan.length} arquivo${plan.length === 1 ? "" : "s"}: ${plan.map((file) => file.split("/").pop()).join(", ")}`);

  step(2, "Contagens da origem");
  const source = parseCounts(docker([...compose, "exec", "-T", "backup", "bash", "/backup/backup.sh", "counts"]).stdout);
  ok(`${source.size} tabelas`);

  step(3, "SQL Server limpo, sem rede, com os backups só leitura");
  const db = docker([...compose, "ps", "-q", "db"]).stdout.trim();
  if (db === "") {
    throw new Error("o db do compose de produção não está no ar");
  }
  const { volume, image } = backupVolume(JSON.parse(docker(["inspect", db]).stdout));
  const password = generatePassword();
  docker(
    [
      "run", "-d", "--name", clean, "--network", "none",
      "-e", "ACCEPT_EULA=Y", "-e", "MSSQL_PID=Express", "-e", "MSSQL_SA_PASSWORD", "-e", "SQLCMDPASSWORD",
      "-e", "SQLCMDSERVER=127.0.0.1",
      "-v", `${volume}:/var/opt/mssql/backup:ro`, "-v", `${root}infra/backup:/backup:ro`,
      image,
    ],
    { env: { MSSQL_SA_PASSWORD: password, SQLCMDPASSWORD: password } },
  );
  const deadline = Date.now() + 180_000;
  while (docker(["exec", clean, "bash", "-c", sqlcmdReady], { check: false }).status !== 0) {
    if (Date.now() > deadline) {
      throw new Error("o SQL Server limpo não respondeu em 3 min");
    }
    await sleep(2_000);
  }
  ok(`${clean} (${image}) com ${volume}`);

  step(4, "Restauração no banco limpo");
  console.log(indent(docker(["exec", clean, "bash", "/backup/backup.sh", "restore"]).stdout));

  step(5, "Contagens da restauração");
  const restored = parseCounts(docker(["exec", clean, "bash", "/backup/backup.sh", "counts"]).stdout);
  const problems = compareCounts(source, restored);
  if (problems.length > 0) {
    throw new Error(`as contagens não batem:\n${problems.map((p) => `   - ${p}`).join("\n")}`);
  }
  for (const [table, rows] of source) {
    console.log(`   ${table.padEnd(28)} ${rows}`);
  }
  ok("todas as tabelas batem, com usuários e vistorias");

  step(6, "A senha do banco fora do log do backup");
  if (docker([...compose, "logs", "backup"]).stdout.includes(prodPassword)) {
    throw new Error("a senha do banco aparece no log do serviço backup");
  }
  ok("não aparece");

  console.log("\nBackup restaurado num banco limpo, com as contagens batendo.");
} catch (error) {
  failed = true;
  console.error(`\n✗ ${error.message}`);
  const logs = docker(["logs", "--tail", "40", clean], { check: false });
  if (logs.status === 0) {
    console.error(`\nÚltimas linhas do SQL Server limpo:\n${indent(logs.stdout + logs.stderr)}`);
  }
} finally {
  docker(["rm", "-f", clean], { check: false });
}

process.exitCode = failed ? 1 : 0;
