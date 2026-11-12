import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectionString,
  generateJwtKey,
  generatePassword,
  parseArgs,
  prodEnv,
  readEnvValue,
  upsertEnvValue,
  userSecrets,
} from "./lib.mjs";

describe("generatePassword", () => {
  it("cumpre a política do SQL Server só com caracteres seguros", () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword();
      assert.equal(password.length, 32);
      assert.match(password, /^[A-Za-z0-9_-]+$/);
      assert.match(password, /[A-Z]/);
      assert.match(password, /[a-z]/);
      assert.match(password, /\d/);
    }
  });

  it("é aleatória", () => {
    assert.notEqual(generatePassword(), generatePassword());
  });
});

describe("arquivo .env", () => {
  const env = "# comentário\nOUTRA=1\nMSSQL_SA_PASSWORD=velha\n";

  it("lê o valor da chave, vazio se faltar", () => {
    assert.equal(readEnvValue(env, "MSSQL_SA_PASSWORD"), "velha");
    assert.equal(readEnvValue("MSSQL_SA_PASSWORD=\n", "MSSQL_SA_PASSWORD"), "");
    assert.equal(readEnvValue("", "MSSQL_SA_PASSWORD"), "");
  });

  it("troca só a linha da chave", () => {
    assert.equal(
      upsertEnvValue(env, "MSSQL_SA_PASSWORD", "nova"),
      "# comentário\nOUTRA=1\nMSSQL_SA_PASSWORD=nova\n",
    );
  });

  it("acrescenta a chave que falta", () => {
    assert.equal(upsertEnvValue("", "MSSQL_SA_PASSWORD", "nova"), "MSSQL_SA_PASSWORD=nova\n");
    assert.equal(upsertEnvValue("OUTRA=1", "MSSQL_SA_PASSWORD", "nova"), "OUTRA=1\nMSSQL_SA_PASSWORD=nova\n");
  });
});

describe("connectionString", () => {
  it("aponta para o banco local com a senha dada", () => {
    assert.equal(
      connectionString("Abc123"),
      "Server=localhost,1433;Database=vistoria;User Id=sa;Password=Abc123;TrustServerCertificate=True",
    );
  });
});

describe("generateJwtKey", () => {
  it("é base64 de 64 bytes aleatórios", () => {
    const key = generateJwtKey();
    assert.equal(Buffer.from(key, "base64").length, 64);
    assert.equal(Buffer.from(key, "base64").toString("base64"), key);
    assert.notEqual(generateJwtKey(), key);
  });
});

describe("userSecrets", () => {
  it("grava a connection string e a chave do JWT nas chaves que a API lê", () => {
    assert.deepEqual(userSecrets("Abc123", "chave"), {
      ConnectionStrings: { Default: connectionString("Abc123") },
      Jwt: { SigningKey: "chave" },
    });
  });
});

describe("parseArgs", () => {
  it("aceita só --rotate", () => {
    assert.deepEqual(parseArgs([]), { rotate: false });
    assert.deepEqual(parseArgs(["--rotate"]), { rotate: true });
    assert.throws(() => parseArgs(["--force"]), /Opção desconhecida/);
  });
});

describe("prodEnv", () => {
  it("traz a senha e a chave pelos nomes que o compose de produção lê", () => {
    const text = prodEnv("Senha123abc", "chave+/=");
    assert.equal(readEnvValue(text, "MSSQL_SA_PASSWORD"), "Senha123abc");
    assert.equal(readEnvValue(text, "JWT_SIGNING_KEY"), "chave+/=");
  });

  it("gera uma senha e uma chave novas a cada chamada", () => {
    const [a, b] = [prodEnv(), prodEnv()];
    assert.notEqual(readEnvValue(a, "MSSQL_SA_PASSWORD"), readEnvValue(b, "MSSQL_SA_PASSWORD"));
    assert.notEqual(readEnvValue(a, "JWT_SIGNING_KEY"), readEnvValue(b, "JWT_SIGNING_KEY"));
    assert.match(readEnvValue(a, "MSSQL_SA_PASSWORD"), /^[A-Za-z0-9_-]{32}$/);
    assert.equal(Buffer.from(readEnvValue(a, "JWT_SIGNING_KEY"), "base64").length, 64);
  });
});
