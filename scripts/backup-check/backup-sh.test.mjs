// O infra/backup/backup.sh de verdade, no bash desta máquina, sobre uma pasta com arquivos vazios e o relógio fixo
// (NOW). Só os subcomandos que não falam com o banco: due, prune, plan e health.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../infra/backup/backup.sh", import.meta.url));
const dirs = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop(), { recursive: true, force: true });
  }
});

const stamp = (iso) => iso.replaceAll("-", "").replaceAll(":", "").replace(/\.\d+/, "");
const full = (iso) => `vistoria_full_${stamp(iso)}.bak`;
const log = (iso) => `vistoria_log_${stamp(iso)}.trn`;

function backupDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "backup-sh-"));
  dirs.push(dir);
  for (const file of files) {
    writeFileSync(path.join(dir, file), "");
  }
  return dir;
}

function run(command, dir, now) {
  const env = { ...process.env, BACKUP_DIR: dir, NOW: String(Date.parse(now) / 1000) };
  return spawnSync("bash", [script, command], { env, encoding: "utf8" });
}

const sh = (command, dir, now) => {
  const result = run(command, dir, now);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test("due: full quando não há nenhum", () => {
  assert.equal(sh("due", backupDir([]), "2026-11-26T10:00:00Z"), "full");
});

test("due: full depois das 06:00 UTC se o último é de antes", () => {
  const dir = backupDir([full("2026-11-25T06:00:00Z"), log("2026-11-26T05:50:00Z")]);
  assert.equal(sh("due", dir, "2026-11-26T05:59:00Z"), "none");
  assert.equal(sh("due", dir, "2026-11-26T06:00:00Z"), "full");
});

test("due: full se o de ontem não saiu, mesmo antes das 06:00", () => {
  const dir = backupDir([full("2026-11-24T06:00:00Z"), log("2026-11-26T03:50:00Z")]);
  assert.equal(sh("due", dir, "2026-11-26T04:00:00Z"), "full");
});

test("due: log a cada 15 min contados do último backup, full ou log", () => {
  const dir = backupDir([full("2026-11-26T06:00:00Z"), log("2026-11-26T09:40:00Z")]);
  assert.equal(sh("due", dir, "2026-11-26T09:54:59Z"), "none");
  assert.equal(sh("due", dir, "2026-11-26T09:55:00Z"), "log");
  assert.equal(sh("due", backupDir([full("2026-11-26T06:00:00Z")]), "2026-11-26T06:15:00Z"), "log");
});

test("prune: 7 fulls diários, os de domingo até 28 dias e os logs que encadeiam com eles", () => {
  const fulls = [];
  for (let day = Date.parse("2026-10-20T06:00:00Z"); day <= Date.parse("2026-11-26T06:00:00Z"); day += 86_400_000) {
    fulls.push(full(new Date(day).toISOString()));
  }
  const logs = [log("2026-11-19T12:00:00Z"), log("2026-11-20T07:00:00Z"), log("2026-11-26T09:45:00Z")];
  const dir = backupDir([...fulls, ...logs, "outro-arquivo.txt"]);

  sh("prune", dir, "2026-11-26T10:00:00Z");

  assert.deepEqual(readdirSync(dir).sort(), [
    "outro-arquivo.txt",
    log("2026-11-20T07:00:00Z"),
    log("2026-11-26T09:45:00Z"),
    // Domingos: 25/10 passou dos 28 dias; 22/11 já é diário.
    full("2026-11-01T06:00:00Z"),
    full("2026-11-08T06:00:00Z"),
    full("2026-11-15T06:00:00Z"),
    full("2026-11-20T06:00:00Z"),
    full("2026-11-21T06:00:00Z"),
    full("2026-11-22T06:00:00Z"),
    full("2026-11-23T06:00:00Z"),
    full("2026-11-24T06:00:00Z"),
    full("2026-11-25T06:00:00Z"),
    full("2026-11-26T06:00:00Z"),
  ].sort());
});

test("prune: o último full e os logs depois dele ficam, por mais velhos que sejam", () => {
  const files = [full("2026-09-01T06:00:00Z"), full("2026-09-02T06:00:00Z"), log("2026-09-02T06:15:00Z")];
  const dir = backupDir(files);

  sh("prune", dir, "2026-11-26T10:00:00Z");

  assert.deepEqual(readdirSync(dir).sort(), [full("2026-09-02T06:00:00Z"), log("2026-09-02T06:15:00Z")].sort());
});

test("plan: o último full e só os logs depois dele, em ordem", () => {
  const dir = backupDir([
    full("2026-11-25T06:00:00Z"),
    log("2026-11-25T23:45:00Z"),
    full("2026-11-26T06:00:00Z"),
    log("2026-11-26T06:30:00Z"),
    log("2026-11-26T06:15:00Z"),
    "vistoria_log_20261126T064500Z.trn.part",
  ]);

  const plan = sh("plan", dir, "2026-11-26T07:00:00Z").split("\n");

  assert.deepEqual(plan, [
    path.join(dir, full("2026-11-26T06:00:00Z")),
    path.join(dir, log("2026-11-26T06:15:00Z")),
    path.join(dir, log("2026-11-26T06:30:00Z")),
  ]);
});

test("plan: sem full, sai com erro", () => {
  const result = run("plan", backupDir([log("2026-11-26T06:15:00Z")]), "2026-11-26T07:00:00Z");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nenhum full/);
});

test("health: um full e o último backup com menos de 30 min", () => {
  const dir = backupDir([full("2026-11-26T06:00:00Z"), log("2026-11-26T09:40:00Z")]);
  assert.equal(run("health", dir, "2026-11-26T10:09:59Z").status, 0);
  assert.notEqual(run("health", dir, "2026-11-26T10:10:00Z").status, 0);
  assert.notEqual(run("health", backupDir([log("2026-11-26T09:40:00Z")]), "2026-11-26T09:41:00Z").status, 0);
});

// O -P nos comandos é do SecretsTests (API), que olha os composes e os scripts de infra/.
test("o backup.sh nunca expande a senha: o sqlcmd a lê sozinho do ambiente", () => {
  assert.doesNotMatch(readFileSync(script, "utf8"), /\$\{?SQLCMDPASSWORD/);
});
