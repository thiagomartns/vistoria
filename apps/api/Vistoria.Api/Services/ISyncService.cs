using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

/// <summary>O delta de uma entidade (backend.md, "Leitura por delta"), no formato do DTO dela.</summary>
public interface ISyncService<TDto>
{
    /// <summary>
    /// Até <paramref name="limit"/> mudanças de <paramref name="ownerId"/> depois de <paramref name="cursor"/>. Cursor
    /// vazio é o primeiro sync, só com registros vivos. Cursor ilegível → <c>InvalidCursorException</c>; mais velho que
    /// a retenção de tombstones → <c>CursorExpiredException</c>.
    /// </summary>
    Task<SyncPageDto<TDto>> PageAsync(Guid ownerId, string? cursor, int limit, CancellationToken cancellationToken);
}
