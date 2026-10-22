using Vistoria.Api.Configurations;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Infrastructure.Background;

/// <summary>
/// A cada <see cref="IdempotencyConfig.CleanupInterval"/>, apaga as <c>Idempotency-Key</c> vencidas (backend.md,
/// "Parâmetros compartilhados"). O primeiro ciclo é depois de um intervalo, nunca no startup. Seguro em várias
/// instâncias sem trava: é um <c>DELETE</c> só, e a instância que chega depois não acha mais as linhas.
/// </summary>
public sealed partial class CleanupService(
    IServiceScopeFactory scopes,
    TimeProvider time,
    ILogger<CleanupService> logger) : BackgroundService
{
    /// <summary>Um ciclo da limpeza. Devolve quantas chaves apagou.</summary>
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var records = scope.ServiceProvider.GetRequiredService<IIdempotencyRepository>();
        var deleted = await records.DeleteAllExpiredAsync(
            time.GetUtcNow() - IdempotencyConfig.KeyValidity, cancellationToken);
        LogCleaned(logger, deleted);
        return deleted;
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

    [LoggerMessage(Level = LogLevel.Information, Message = "Limpeza: {Deleted} Idempotency-Key vencidas apagadas")]
    private static partial void LogCleaned(ILogger logger, int deleted);

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha na limpeza das Idempotency-Key vencidas")]
    private static partial void LogFailed(ILogger logger, Exception exception);
}
