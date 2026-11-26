// A parte pura do `pnpm backup:check` (#196): ler as contagens do `backup.sh counts`, comparar a origem com a
// restauração e achar o volume dos backups no `docker inspect` do db.

export const BACKUP_PATH = "/var/opt/mssql/backup";

// Tabelas que precisam ter linhas: sem isso, um banco vazio restaurado de um backup vazio passaria.
export const REQUIRED_TABLES = ["dbo.users", "dbo.inspections"];

// `schema.tabela<TAB>linhas`, uma por linha; o resto (linha em branco do sqlcmd) fica de fora.
export function parseCounts(text) {
  const counts = new Map();
  for (const line of text.split("\n")) {
    const match = /^(\S+)\t(\d+)\s*$/.exec(line);
    if (match) {
      counts.set(match[1], Number(match[2]));
    }
  }
  return counts;
}

export function compareCounts(source, restored, required = REQUIRED_TABLES) {
  const problems = [];
  if (source.size === 0) {
    problems.push("a origem não tem tabela nenhuma");
  }
  for (const [table, rows] of source) {
    if (!restored.has(table)) {
      problems.push(`${table}: falta na restauração`);
    } else if (restored.get(table) !== rows) {
      problems.push(`${table}: ${rows} na origem, ${restored.get(table)} na restauração`);
    }
  }
  for (const table of restored.keys()) {
    if (!source.has(table)) {
      problems.push(`${table}: só na restauração`);
    }
  }
  for (const table of required) {
    if (!(source.get(table) > 0)) {
      problems.push(`${table}: vazia na origem`);
    }
  }
  return problems;
}

// O nome do volume montado em /var/opt/mssql/backup no container do db (o compose prefixa com o projeto).
export function backupVolume(inspect) {
  const [container] = inspect;
  const mount = container?.Mounts?.find((m) => m.Destination === BACKUP_PATH && m.Type === "volume");
  if (!mount) {
    throw new Error(`o db não tem volume em ${BACKUP_PATH}`);
  }
  return { volume: mount.Name, image: container.Config.Image };
}
