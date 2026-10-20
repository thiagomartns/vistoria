import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectionString,
  generatePassword,
  parseArgs,
  readEnvValue,
  upsertEnvValue,
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

describe("parseArgs", () => {
  it("aceita só --rotate", () => {
    assert.deepEqual(parseArgs([]), { rotate: false });
    assert.deepEqual(parseArgs(["--rotate"]), { rotate: true });
    assert.throws(() => parseArgs(["--force"]), /Opção desconhecida/);
  });
});
