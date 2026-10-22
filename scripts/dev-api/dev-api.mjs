// `pnpm dev:api`: confere o ambiente e só então roda o `dotnet watch` da API. Cada falha diz o que fazer.
//
//   - outro `dotnet watch` da API rodando ou porta 8080 ocupada → para (dois watchers estouram o limite de inotify);
//   - User Secrets sem a connection string ou a chave do JWT → para e manda rodar `pnpm db:init` (só nomes, nunca
//     valores, são lidos daqui);
//   - banco parado (por exemplo, depois de um reboot) → sobe com `docker compose up -d --wait`.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { API_PORT, apiWatcherPids, dbReady, missingSecrets } from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const apiDir = join(root, "apps", "api");
const apiProject = join(apiDir, "Vistoria.Api");
const composePath = join(root, "infra", "docker-compose.dev.yml");
const envPath = join(root, "infra", ".env");
const container = "vistoria-db";

function fail(message) {
  console.error(`dev:api: ${message}`);
  process.exit(1);
}

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function portInUse(port) {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

const watchers = apiWatcherPids(output("ps", ["-axww", "-o", "pid=,args="]), process.pid);
if (watchers.length > 0) {
  fail(
    `já há um dotnet watch da API rodando (pid ${Math.min(...watchers)}). Use aquele terminal ` +
      "(Ctrl+R reinicia) ou encerre-o antes.",
  );
}

if (await portInUse(API_PORT)) {
  fail(`a porta ${API_PORT} está ocupada. Veja quem a usa com: ss -ltnp 'sport = :${API_PORT}'`);
}

let secrets;
try {
  secrets = output("dotnet", ["user-secrets", "list", "--project", apiProject]);
} catch {
  fail("não consegui ler os User Secrets da API. O SDK do .NET está no PATH?");
}
const missing = missingSecrets(secrets);
secrets = undefined; // a saída tem os valores; daqui em diante só os nomes que faltam
if (missing.length > 0) {
  fail(`faltam nos User Secrets: ${missing.join(", ")}. Rode pnpm db:init.`);
}

let dbState = "";
try {
  dbState = output("docker", [
    "inspect",
    "-f",
    "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
    container,
  ]);
} catch {
  // container inexistente: o compose cria
}
if (!dbReady(dbState)) {
  if (!existsSync(envPath)) {
    fail("infra/.env não existe. Rode pnpm db:init para gerar a senha local.");
  }
  console.log(`dev:api: banco ${dbState.trim() || "inexistente"}; subindo com pnpm db:up...`);
  try {
    execFileSync("docker", ["compose", "-f", composePath, "up", "-d", "--wait"], { stdio: "inherit" });
  } catch {
    fail("o banco não subiu. O Docker está rodando? Veja os logs com: docker logs vistoria-db");
  }
}

// O Ctrl+C chega ao grupo inteiro; este processo só espera o watch terminar e repassa o código de saída.
const watch = spawn("dotnet", ["watch", "run", "--project", "Vistoria.Api"], { cwd: apiDir, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {});
}
watch.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
