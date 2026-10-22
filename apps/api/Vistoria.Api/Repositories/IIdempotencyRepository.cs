using Vistoria.Api.Model;

namespace Vistoria.Api.Repositories;

/// <summary>
/// Linhas de <see cref="IdempotencyRecord"/>. Nada fica no change tracker: o <c>DbContext</c> é o mesmo do service
/// que a requisição executa, e um <c>SaveChanges</c> dele não pode regravar a chave.
/// </summary>
public interface IIdempotencyRepository
{
    /// <summary>
    /// Grava a chave como <see cref="IdempotencyState.Processing"/>. Devolve <c>false</c> se a chave do mesmo usuário
    /// já existe: outra requisição (talvez de outra instância) chegou antes.
    /// </summary>
    Task<bool> TryStartAsync(IdempotencyRecord record, CancellationToken cancellationToken);

    Task<IdempotencyRecord?> FindAsync(Guid userId, Guid key, CancellationToken cancellationToken);

    /// <summary>Marca como <see cref="IdempotencyState.Done"/> com a resposta que o reenvio vai repetir.</summary>
    Task CompleteAsync(
        Guid userId, Guid key, int statusCode, string responseHeaders, byte[] responseBody,
        CancellationToken cancellationToken);

    /// <summary>Apaga a chave, para o retry executar de novo (resposta 5xx).</summary>
    Task DeleteAsync(Guid userId, Guid key, CancellationToken cancellationToken);

    /// <summary>Apaga a chave só se ela foi criada antes de <paramref name="cutoff"/> (vencida e ainda não limpa).</summary>
    Task DeleteIfExpiredAsync(Guid userId, Guid key, DateTimeOffset cutoff, CancellationToken cancellationToken);

    /// <summary>
    /// Apaga todas as chaves criadas antes de <paramref name="cutoff"/> e devolve quantas apagou. Um só <c>DELETE</c>:
    /// duas instâncias rodando juntas não falham, e cada linha é apagada por uma delas só.
    /// </summary>
    Task<int> DeleteAllExpiredAsync(DateTimeOffset cutoff, CancellationToken cancellationToken);
}
