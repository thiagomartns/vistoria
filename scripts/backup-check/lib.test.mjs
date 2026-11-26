import assert from "node:assert/strict";
import { test } from "node:test";

import { backupVolume, compareCounts, parseCounts } from "./lib.mjs";

const counts = (entries) => new Map(Object.entries(entries));

test("parseCounts lê as linhas do backup.sh counts e ignora o resto", () => {
  const parsed = parseCounts("dbo.clients\t21\ndbo.users\t3\n\n(2 rows affected)\n");
  assert.deepEqual([...parsed], [
    ["dbo.clients", 21],
    ["dbo.users", 3],
  ]);
});

test("compareCounts passa quando as contagens batem e as obrigatórias têm linhas", () => {
  const source = counts({ "dbo.users": 2, "dbo.inspections": 5, "dbo.rooms": 0 });
  assert.deepEqual(compareCounts(source, new Map(source)), []);
});

test("compareCounts aponta tabela com contagem diferente, faltando ou a mais", () => {
  const source = counts({ "dbo.users": 2, "dbo.inspections": 5, "dbo.rooms": 7 });
  const restored = counts({ "dbo.users": 2, "dbo.inspections": 4, "dbo.extra": 1 });
  assert.deepEqual(compareCounts(source, restored), [
    "dbo.inspections: 5 na origem, 4 na restauração",
    "dbo.rooms: falta na restauração",
    "dbo.extra: só na restauração",
  ]);
});

test("compareCounts recusa vazio igual a vazio", () => {
  const empty = counts({ "dbo.users": 0, "dbo.inspections": 0 });
  assert.deepEqual(compareCounts(empty, new Map(empty)), [
    "dbo.users: vazia na origem",
    "dbo.inspections: vazia na origem",
  ]);
  assert.deepEqual(compareCounts(new Map(), new Map()), [
    "a origem não tem tabela nenhuma",
    "dbo.users: vazia na origem",
    "dbo.inspections: vazia na origem",
  ]);
});

test("backupVolume acha o volume dos backups e a imagem do db", () => {
  const inspect = [
    {
      Config: { Image: "mcr.microsoft.com/mssql/server:2022-CU28-ubuntu-22.04" },
      Mounts: [
        { Type: "volume", Name: "vistoria-prod_sqldata", Destination: "/var/opt/mssql" },
        { Type: "volume", Name: "vistoria-prod_sqlbackup", Destination: "/var/opt/mssql/backup" },
      ],
    },
  ];
  assert.deepEqual(backupVolume(inspect), {
    volume: "vistoria-prod_sqlbackup",
    image: "mcr.microsoft.com/mssql/server:2022-CU28-ubuntu-22.04",
  });
  assert.throws(() => backupVolume([{ Config: {}, Mounts: [] }]), /não tem volume/);
});
