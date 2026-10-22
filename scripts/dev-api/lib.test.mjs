import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiWatcherPids, dbReady, missingSecrets, secretNames } from "./lib.mjs";

describe("User Secrets", () => {
  const list = "Jwt:SigningKey = c2VncmVkbw==\nConnectionStrings:Default = Server=localhost;Password=x = y\n";

  it("lê só os nomes, nunca os valores", () => {
    const names = secretNames(list);
    assert.deepEqual(names, ["Jwt:SigningKey", "ConnectionStrings:Default"]);
    assert.ok(names.every((n) => !n.includes("c2VncmVkbw") && !n.includes("Password")));
  });

  it("aponta os que faltam", () => {
    assert.deepEqual(missingSecrets(list), []);
    assert.deepEqual(missingSecrets("Jwt:SigningKey = abc\n"), ["ConnectionStrings:Default"]);
    assert.deepEqual(missingSecrets("No secrets configured for this application.\n"), [
      "ConnectionStrings:Default",
      "Jwt:SigningKey",
    ]);
  });
});

describe("dotnet watch da API", () => {
  const ps = [
    "  101 /home/u/.dotnet/dotnet /home/u/.dotnet/sdk/10.0.402/DotnetTools/dotnet-watch/10.0.402/tools/net10.0/any/dotnet-watch.dll run --project Vistoria.Api",
    "  102 node /repo/scripts/dev-api/dev-api.mjs",
    "  103 /home/u/.dotnet/dotnet watch run --project Outro.Api",
    "  104 /home/u/.dotnet/dotnet /repo/apps/api/Vistoria.Api/bin/Debug/net10.0/Vistoria.Api.dll",
    "  105 dotnet watch run --project Vistoria.Api",
    "",
  ].join("\n");

  it("acha o watch da API e ignora o resto", () => {
    assert.deepEqual(apiWatcherPids(ps, 102), [101, 105]);
  });

  it("ignora o próprio processo", () => {
    assert.deepEqual(apiWatcherPids(ps, 101), [105]);
  });
});

describe("estado do banco", () => {
  it("só pronto quando rodando e saudável", () => {
    assert.equal(dbReady("running healthy\n"), true);
    assert.equal(dbReady("running starting\n"), false);
    assert.equal(dbReady("exited \n"), false);
    assert.equal(dbReady(""), false);
  });
});
