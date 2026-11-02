using Vistoria.Api.Configurations;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Infrastructure.Background;

/// <summary>Quanto um ciclo da limpeza apagou.</summary>
/// <param name="Keys"><c>Idempotency-Key</c> vencidas.</param>
/// <param name="Tombstones">Vistorias excluídas há mais que a retenção, cada uma com os ambientes e itens dela.</param>
public sealed record CleanupResult(int Keys, int Tombstones);

/// <summary>
/// A cada <see cref="IdempotencyConfig.CleanupInterval"/>, apaga as <c>Idempotency-Key</c> vencidas e os tombstones
/// mais velhos que <see cref="SyncConfig.TombstoneRetention"/> (backend.md, "Parâmetros compartilhados"). O primeiro
/// ciclo é depois de um intervalo, nunca no startup. Seguro em várias instâncias sem trava: é um <c>DELETE</c> só por
/// tabela, e a instância que chega depois não acha mais as linhas.
/// </summary>
public sealed partial class CleanupService(
    IServiceScopeFactory scopes,
    TimeProvider time,
    ILogger<CleanupService> logger) : BackgroundService
{
    /// <summary>Um ciclo da limpeza. Devolve quantas chaves e quantos tombstones apagou.</summary>
    public async Task<CleanupResult> RunOnceAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var records = scope.ServiceProvider.GetRequiredService<IIdempotencyRepository>();
        var inspections = scope.ServiceProvider.GetRequiredService<IInspectionRepository>();
        var now = time.GetUtcNow();

        var keys = await records.DeleteAllExpiredAsync(now - IdempotencyConfig.KeyValidity, cancellationToken);
        var tombstones = await inspections.PurgeDeletedBeforeAsync(
            now - SyncConfig.TombstoneRetention, cancellationToken);
        LogCleaned(logger, keys, tombstones);
        return new CleanupResult(keys, tombstones);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(IdempotencyConfig.CleanupInterval, time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    // Um ciclo que falha (banco fora do ar) não derruba a API; o próximo tenta de novo.
                    LogFailed(logger, e);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Limpeza: {Keys} Idempotency-Key vencidas e {Tombstones} tombstones apagados")]
    private static partial void LogCleaned(ILogger logger, int keys, int tombstones);

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha na limpeza das Idempotency-Key e dos tombstones vencidos")]
    private static partial void LogFailed(ILogger logger, Exception exception);
}
