# 0070 — Backup do banco de produção: full diário e log a cada 15 min, num volume à parte, restaurado num banco limpo no CI (#196)

- **Status:** Proposto
- **Data:** 2026-11-26

## Contexto

No compose de produção, o banco vivia só no volume `sqldata`, sem backup ([Ambientes e hospedagem](../architecture/backend.md#ambientes-e-hospedagem)). Um `down -v` ou um banco corrompido apagava tudo, contra a promessa de que nenhum registro feito em campo se perde. A [ADR 0011](0011-hospedagem-docker-compose-mesma-origem.md) aceita operar o backup por conta própria, e o SQL Server Express não tem o SQL Server Agent para agendá-lo.

## Decisão

- **Recuperação FULL, RPO de 15 min:** um backup completo por dia, às 06:00 UTC (03:00 em Brasília), e um de log a cada 15 min, os dois `WITH CHECKSUM`.
- **O agendamento** é o serviço `backup` do compose: a imagem do `db`, com o `infra/backup/backup.sh` num loop. O sqlcmd lê a senha do `SQLCMDPASSWORD`, nunca do `-P`.
- **O destino** é o volume `sqlbackup`, separado do `sqldata`. O `sqlservr` grava ali, e o `backup-init` dá o volume ao usuário `mssql`.
- **A retenção:** os fulls de 7 dias, os de domingo até 28 dias e os logs que encadeiam com um full diário guardado.
- **A restauração** é o último full mais os logs depois dele, com `DBCC CHECKDB`. O job `prod` do CI a roda a cada PR (`pnpm backup:check`), num SQL Server limpo e sem rede, e quebra se as contagens por tabela não baterem com as da origem ou se usuários e vistorias estiverem vazias.

## Consequências

Um banco perdido volta com no máximo 15 min de perda, num roteiro que o CI prova a cada PR. O RTO é de minutos: subir o `db` e restaurar a cadeia. Custos aceitos:
- O volume fica no mesmo disco do banco: perder o disco, ou um `down -v`, ainda apaga tudo até a cópia para fora do servidor (#241).
- O servidor precisa do `infra/backup/backup.sh` ao lado do compose, e não só das imagens.
- Até 96 arquivos de log por dia, e a retenção depende do loop estar vivo. O healthcheck do `backup` fica `unhealthy` com 30 min sem backup, mas nada avisa ninguém (#50).
- Restaurar volta o servidor no tempo: um aparelho que sincronizou depois do último log tem o cursor do delta à frente e o que ele enviou some do servidor. O resync dos aparelhos depois de uma restauração fica para depois.
- Sem compressão de backup, que o Express não tem.
