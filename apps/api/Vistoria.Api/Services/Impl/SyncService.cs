using MapsterMapper;
using Vistoria.Api.Configurations;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Repositories;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Services.Impl;

/// <summary>
/// O delta paginado de uma <see cref="SyncEntity"/>. O dono vem do token e vai na consulta, então nada de outro dono
/// sai. O <c>issuedAt</c> do <c>nextCursor</c> diz desde quando o aparelho não perdeu nenhum tombstone: é o instante
/// desta requisição quando ele chegou ao fim (<c>hasMore</c> falso), e no meio da paginação fica o do cursor recebido.
/// Renovar a cada página deixaria uma paginação longa passar por cima de um tombstone já purgado; renovar só no fim
/// faz um aparelho que sincroniza sempre, mesmo sem mudanças, nunca chegar a <c>cursor-expired</c>.
/// </summary>
public class SyncService<TEntity, TDto>(IRepository<TEntity> repository, IMapper mapper, TimeProvider time)
    : ISyncService<TDto>
    where TEntity : SyncEntity
{
    public async Task<SyncPageDto<TDto>> PageAsync(
        Guid ownerId, string? cursor, int limit, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var first = string.IsNullOrEmpty(cursor);
        var from = first ? SyncCursor.Start(now) : Parse(cursor, now);

        // Uma linha a mais só para saber se há outra página.
        var rows = await repository.ChangedSinceAsync(ownerId, from.Version, limit + 1, first, cancellationToken);
        var hasMore = rows.Count > limit;
        var page = hasMore ? rows.Take(limit).ToList() : rows;

        var next = new SyncCursor(
            page.Count > 0 ? page[^1].Version : from.Version,
            hasMore ? from.IssuedAt : now);
        return new SyncPageDto<TDto>(
            [.. page.Where(e => e.DeletedAt is null).Select(mapper.Map<TDto>)],
            [.. page.Where(e => e.DeletedAt is not null).Select(e => e.Id)],
            next.Encode(),
            hasMore);
    }

    // No limite exato da retenção o cursor ainda vale, como a Idempotency-Key no IdempotencyFilter.
    private static SyncCursor Parse(string? cursor, DateTimeOffset now) =>
        !SyncCursor.TryParse(cursor, out var parsed) ? throw new InvalidCursorException()
        : now - parsed.IssuedAt > SyncConfig.TombstoneRetention ? throw new CursorExpiredException()
        : parsed;
}
