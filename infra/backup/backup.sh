#!/usr/bin/env bash
# Backup do banco de produção (#196, ADR 0070). Roda no serviço `backup` do docker-compose.prod.yml, com a imagem do
# SQL Server (o sqlcmd dela). Quem grava o arquivo é o sqlservr do `db`, no volume `sqlbackup`, separado do `sqldata`.
#
# A senha vem do SQLCMDPASSWORD do ambiente, que o sqlcmd lê sozinho: nada de -P, e nenhuma linha daqui a imprime.
#
#   run       o loop do serviço: full às FULL_AT (UTC), log a cada LOG_EVERY_MIN minutos, depois a retenção
#   full|log  um backup agora (com o lock do loop): `docker compose exec backup bash /backup/backup.sh log`
#   due       o que o loop faria agora: full, log ou none
#   prune     a retenção: os fulls de KEEP_DAILY_DAYS dias, os de domingo até KEEP_WEEKLY_DAYS, e os logs que ainda
#             encadeiam com um full guardado; o último full e os logs depois dele nunca saem
#   plan      a sequência da restauração: o último full e os logs depois dele, em ordem
#   restore   restaura o `plan` no servidor do SQLCMDSERVER, confere com o DBCC CHECKDB e deixa o banco pronto
#   counts    o COUNT(*) exato de cada tabela, como `schema.tabela<TAB>linhas`
#   health    sai com 0 se há um full e o último backup tem menos de STALE_MIN minutos
#
# NOW (epoch em segundos) troca o relógio, para os testes (scripts/backup-check).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/opt/mssql/backup}"
DB_NAME="${DB_NAME:-vistoria}"
FULL_AT="${FULL_AT:-06:00}"
LOG_EVERY_MIN="${LOG_EVERY_MIN:-15}"
KEEP_DAILY_DAYS="${KEEP_DAILY_DAYS:-7}"
KEEP_WEEKLY_DAYS="${KEEP_WEEKLY_DAYS:-28}"
STALE_MIN="${STALE_MIN:-30}"
SQLCMD="${SQLCMD:-/opt/mssql-tools18/bin/sqlcmd}"

now() { echo "${NOW:-$(date -u +%s)}"; }
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# vistoria_full_20261126T060000Z.bak → epoch
stamp_of() {
  local s="${1##*/}"
  s="${s#"${DB_NAME}"_*_}"
  s="${s%.*}"
  date -u -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}:${s:11:2}:${s:13:2}" +%s
}

name_for() { echo "${DB_NAME}_$1_$(date -u -d "@$(now)" +%Y%m%dT%H%M%SZ).$2"; }

# O carimbo tem largura fixa: a ordem do nome é a do tempo.
fulls() { find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}_full_*Z.bak" -printf '%f\n' | sort; }
logs() { find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}_log_*Z.trn" -printf '%f\n' | sort; }
latest_full() { fulls | tail -n 1; }

latest_stamp() {
  local f latest=0 s
  for f in $(fulls) $(logs); do
    s=$(stamp_of "$f")
    ((s > latest)) && latest=$s
  done
  echo "$latest"
}

# -r0: os erros saem no stderr, e o >/dev/null dos backups só cala as mensagens de sucesso ("Processed N pages").
sql() { "$SQLCMD" -S "${SQLCMDSERVER:-db}" -U "${SQLCMDUSER:-sa}" -C -b -r0 -h -1 -W "$@"; }

with_lock() { (flock 9 && "$@") 9>"$BACKUP_DIR/.lock"; }

# Grava em .part e só renomeia se o BACKUP terminou: o `plan` nunca pega um arquivo pela metade. Os `|| return 1`
# são de propósito: chamada do loop pelo `||`, a função roda sem o `set -e`.
do_full() {
  local name
  name=$(name_for full bak)
  sql -Q "SET NOCOUNT ON;
    IF (SELECT recovery_model_desc FROM sys.databases WHERE name = N'$DB_NAME') <> N'FULL'
      ALTER DATABASE [$DB_NAME] SET RECOVERY FULL;
    BACKUP DATABASE [$DB_NAME] TO DISK = N'$BACKUP_DIR/$name.part' WITH CHECKSUM, INIT, NAME = N'$name';" >/dev/null ||
    return 1
  mv "$BACKUP_DIR/$name.part" "$BACKUP_DIR/$name" || return 1
  say "full $name"
  # O histórico do msdb cresce a cada backup; o que passou da retenção sai junto com o full.
  sql -Q "DECLARE @oldest datetime = DATEADD(day, -$KEEP_WEEKLY_DAYS, SYSUTCDATETIME());
    EXEC msdb.dbo.sp_delete_backuphistory @oldest_date = @oldest;" >/dev/null || say "histórico do msdb ficou"
}

do_log() {
  if [[ -z "$(latest_full)" ]]; then
    do_full
    return $?
  fi
  local name
  name=$(name_for log trn)
  sql -Q "BACKUP LOG [$DB_NAME] TO DISK = N'$BACKUP_DIR/$name.part' WITH CHECKSUM, INIT, NAME = N'$name';" >/dev/null ||
    return 1
  mv "$BACKUP_DIR/$name.part" "$BACKUP_DIR/$name" || return 1
  say "log $name"
}

# O último horário do full que já passou (hoje às FULL_AT, ou ontem se ainda não deu a hora).
full_boundary() {
  local n b
  n=$(now)
  b=$(date -u -d "$(date -u -d "@$n" +%F) $FULL_AT" +%s)
  ((n < b)) && b=$((b - 86400))
  echo "$b"
}

due() {
  local latest n
  latest=$(latest_full)
  if [[ -z "$latest" ]] || (($(stamp_of "$latest") < $(full_boundary))); then
    echo full
    return
  fi
  n=$(now)
  if ((n - $(latest_stamp) >= LOG_EVERY_MIN * 60)); then
    echo log
  else
    echo none
  fi
}

prune() {
  local n newest newest_stamp oldest_kept f s age
  n=$(now)
  newest=$(latest_full)
  [[ -z "$newest" ]] && return 0
  newest_stamp=$(stamp_of "$newest")
  oldest_kept=$newest_stamp

  for f in $(fulls); do
    s=$(stamp_of "$f")
    age=$((n - s))
    if [[ "$f" == "$newest" ]] || ((age < KEEP_DAILY_DAYS * 86400)); then
      ((s < oldest_kept)) && oldest_kept=$s
      continue
    fi
    # Os semanais restauram sozinhos, sem os logs.
    if ((age < KEEP_WEEKLY_DAYS * 86400)) && [[ "$(date -u -d "@$s" +%u)" == 7 ]]; then
      continue
    fi
    rm -f "$BACKUP_DIR/$f"
    say "prune $f"
  done

  # Um log vale enquanto encadeia com um full diário guardado.
  for f in $(logs); do
    s=$(stamp_of "$f")
    ((s >= oldest_kept)) && continue
    rm -f "$BACKUP_DIR/$f"
    say "prune $f"
  done

  find "$BACKUP_DIR" -maxdepth 1 -name '*.part' -mmin +1440 -delete
}

plan() {
  local full full_stamp f
  full=$(latest_full)
  if [[ -z "$full" ]]; then
    echo "nenhum full em $BACKUP_DIR" >&2
    return 1
  fi
  full_stamp=$(stamp_of "$full")
  echo "$BACKUP_DIR/$full"
  for f in $(logs); do
    (($(stamp_of "$f") > full_stamp)) && echo "$BACKUP_DIR/$f"
  done
  return 0
}

restore() {
  local list files f
  list=$(plan)
  mapfile -t files <<<"$list"
  say "restore ${files[0]##*/}"
  sql -Q "RESTORE DATABASE [$DB_NAME] FROM DISK = N'${files[0]}' WITH NORECOVERY, REPLACE, CHECKSUM;" >/dev/null
  for f in "${files[@]:1}"; do
    say "restore ${f##*/}"
    sql -Q "RESTORE LOG [$DB_NAME] FROM DISK = N'$f' WITH NORECOVERY, CHECKSUM;" >/dev/null
  done
  sql -Q "RESTORE DATABASE [$DB_NAME] WITH RECOVERY;" >/dev/null
  sql -Q "DBCC CHECKDB([$DB_NAME]) WITH NO_INFOMSGS;"
  say "restore ok: ${#files[@]} arquivos"
}

counts() {
  sql -s $'\t' -Q "SET NOCOUNT ON;
    DECLARE @q nvarchar(max);
    SELECT @q = STRING_AGG(CAST(N'SELECT N''' + s.name + N'.' + t.name + N''' AS t, COUNT_BIG(*) AS n FROM '
      + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) AS nvarchar(max)), N' UNION ALL ')
    FROM [$DB_NAME].sys.tables t JOIN [$DB_NAME].sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0;
    SET @q = N'USE [$DB_NAME]; ' + @q + N' ORDER BY t;';
    EXEC sp_executesql @q;"
}

health() {
  [[ -n "$(latest_full)" ]] && (($(now) - $(latest_stamp) < STALE_MIN * 60))
}

run() {
  say "backup de $DB_NAME em $BACKUP_DIR: full às $FULL_AT UTC, log a cada $LOG_EVERY_MIN min"
  while true; do
    case "$(due)" in
      full) with_lock do_full || say "full falhou" ;;
      log) with_lock do_log || say "log falhou" ;;
    esac
    prune || say "prune falhou"
    sleep 60
  done
}

case "${1:-}" in
  run) run ;;
  full) with_lock do_full ;;
  log) with_lock do_log ;;
  due | prune | plan | restore | counts | health) "$1" ;;
  *)
    echo "uso: backup.sh run|full|log|due|prune|plan|restore|counts|health" >&2
    exit 2
    ;;
esac
