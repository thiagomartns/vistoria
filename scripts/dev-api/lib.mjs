export const REQUIRED_SECRETS = ["ConnectionStrings:Default", "Jwt:SigningKey"];
export const API_PORT = 8080;

// Saída do `dotnet user-secrets list` ("Chave = valor" por linha) → só os nomes. O valor nunca sai desta função.
export function secretNames(listOutput) {
  return listOutput
    .split("\n")
    .filter((line) => line.includes(" = "))
    .map((line) => line.slice(0, line.indexOf(" = ")).trim())
    .filter((name) => name !== "");
}

export function missingSecrets(listOutput) {
  const names = new Set(secretNames(listOutput));
  return REQUIRED_SECRETS.filter((name) => !names.has(name));
}

// Linhas do `ps -axww -o pid=,args=` → pids de um `dotnet watch` da API que não seja este processo.
export function apiWatcherPids(psOutput, ownPid) {
  return psOutput
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((m) => m !== null && Number(m[1]) !== ownPid)
    .filter(([, , args]) => /dotnet-watch|dotnet\s+watch/.test(args) && /Vistoria\.Api/.test(args))
    .map(([, pid]) => Number(pid));
}

// Saída do `docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'`.
export function dbReady(inspectOutput) {
  return inspectOutput.trim() === "running healthy";
}
