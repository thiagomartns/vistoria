import { randomBytes } from "node:crypto";

export const PASSWORD_KEY = "MSSQL_SA_PASSWORD";

// Base64url: letras, dígitos, - e _. Nada que o shell, o YAML do compose ou a connection string interpretem
// (sem !, $, ;, aspas). A política do SQL Server pede 8+ caracteres de três categorias; exigimos as três daqui.
export function generatePassword(length = 32) {
  for (;;) {
    const password = randomBytes(length).toString("base64url").slice(0, length);
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)) {
      return password;
    }
  }
}

export function readEnvValue(text, key) {
  const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
  return line === undefined ? "" : line.slice(key.length + 1).trim();
}

// Troca (ou acrescenta) só a linha da chave; comentários e outras variáveis ficam como estão.
export function upsertEnvValue(text, key, value) {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index === -1) {
    lines.push(`${key}=${value}`);
  } else {
    lines[index] = `${key}=${value}`;
  }
  return `${lines.join("\n")}\n`;
}

export function connectionString(password) {
  return `Server=localhost,1433;Database=vistoria;User Id=sa;Password=${password};TrustServerCertificate=True`;
}

export function parseArgs(argv) {
  const unknown = argv.filter((a) => a !== "--rotate");
  if (unknown.length > 0) {
    throw new Error(`Opção desconhecida: ${unknown.join(" ")}. Uso: pnpm db:init [--rotate]`);
  }
  return { rotate: argv.includes("--rotate") };
}
