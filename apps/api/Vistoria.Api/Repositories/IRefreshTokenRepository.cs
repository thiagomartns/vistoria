using Vistoria.Api.Model;

namespace Vistoria.Api.Repositories;

/// <summary>
/// Linhas de <see cref="RefreshToken"/>. Nada fica no change tracker; as trocas de estado são um <c>UPDATE</c> com a
/// condição no <c>WHERE</c>, então duas requisições com o mesmo cookie não passam juntas pela mesma checagem.
/// </summary>
public interface IRefreshTokenRepository
{
    Task AddAsync(RefreshToken token, CancellationToken cancellationToken);

    Task<RefreshToken?> FindByHashAsync(byte[] tokenHash, CancellationToken cancellationToken);

    /// <summary>
    /// Marca o token como substituído se ele ainda não foi substituído nem revogado. Devolve <c>false</c> se outra
    /// requisição chegou antes.
    /// </summary>
    Task<bool> TryMarkReplacedAsync(Guid id, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Revoga todos os tokens ainda não revogados da família.</summary>
    Task RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken cancellationToken);
}
