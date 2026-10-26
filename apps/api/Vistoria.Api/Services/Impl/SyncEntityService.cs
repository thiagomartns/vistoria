using MapsterMapper;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Repositories;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Services.Impl;

/// <summary>
/// <c>GET</c>, <c>PUT</c> (upsert) e <c>DELETE</c> de uma <see cref="SyncEntity"/>, na ordem de backend.md, "Sync →
/// Escrita": dono, exclusão (410), trava (<see cref="IsLocked"/>), versão (<c>If-Match</c>), regras da entidade
/// (<see cref="ValidateAsync"/>) e gravação. O dono é conferido aqui, não num filtro global: o <c>PUT</c> precisa
/// distinguir "de outro dono" (403) de "não existe" (cria). Dono vem antes de exclusão e trava, para o estado do
/// registro de outro dono não vazar.
/// </summary>
public abstract class SyncEntityService<TEntity, TDto>(IRepository<TEntity> repository, IMapper mapper)
    where TEntity : SyncEntity
    where TDto : notnull
{
    /// <summary>Inexistente ou de outro dono → a mesma <c>NotFoundException</c>: o id de outro dono não vaza.</summary>
    public async Task<TDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken)
    {
        var entity = await repository.FindByIdAsync(id, cancellationToken);
        if (entity is null || entity.OwnerId != ownerId)
        {
            throw new NotFoundException();
        }

        return mapper.Map<TDto>(entity);
    }

    /// <summary>
    /// Soft delete com as mesmas regras de dono, trava e <paramref name="ifMatch"/> do upsert. Inexistente ou já
    /// excluído, de qualquer dono, só retorna (204): é o efeito pedido, e responder igual não revela o id de ninguém.
    /// Perder a corrida para outra exclusão também só retorna; para outra gravação, o mesmo 409 do upsert.
    /// </summary>
    public async Task DeleteAsync(Guid ownerId, Guid id, string? ifMatch, CancellationToken cancellationToken)
    {
        var current = await repository.FindByIdAsync(id, cancellationToken);
        if (current is null)
        {
            return;
        }

        if (Refusal(ownerId, current) is { } refusal)
        {
            throw refusal;
        }

        var baseVersion = BaseVersion(ifMatch, current);
        bool deleted;
        try
        {
            // false: outra exclusão passou entre a leitura e a gravação.
            deleted = await repository.DeleteAsync(id, baseVersion, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Outra gravação passou entre a leitura e o SaveChanges.
            deleted = false;
        }

        if (!deleted && await repository.FindByIdAsync(id, cancellationToken) is { } latest)
        {
            throw Conflict(ownerId, latest);
        }
    }

    /// <summary>
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava <paramref name="proposed"/>. Na criação o <c>If-Match</c> é
    /// ignorado; num registro existente ele é obrigatório (428) e precisa ser a versão atual (412). Registro excluído →
    /// 410 <c>deleted</c>; travado → 409 <c>locked</c>, mesmo com <c>If-Match</c> velho. Corrida com outra gravação →
    /// a mesma regra contra o vencedor: 410, 409 <c>locked</c> ou 409 <c>version-conflict</c> com o registro atual.
    /// </summary>
    protected async Task<(TDto Dto, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, TEntity proposed, CancellationToken cancellationToken)
    {
        var current = await repository.FindByIdAsync(id, cancellationToken);
        var refusal = current is null
            ? await TombstoneRefusal(ownerId, id, cancellationToken)
            : Refusal(ownerId, current);
        if (refusal is not null)
        {
            throw refusal;
        }

        var baseVersion = current is null ? null : BaseVersion(ifMatch, current);

        proposed.Id = id;
        proposed.OwnerId = ownerId;
        await ValidateAsync(proposed, ownerId, cancellationToken);

        if (baseVersion is null)
        {
            try
            {
                return (mapper.Map<TDto>(await repository.AddAsync(proposed, cancellationToken)), true);
            }
            catch (DuplicateIdException)
            {
                // Outra criação do mesmo id passou entre a leitura e o SaveChanges.
                throw await ConflictWithLatest(ownerId, id, cancellationToken);
            }
        }

        proposed.Version = baseVersion;
        TEntity? updated;
        try
        {
            // null: excluído entre a leitura e a gravação.
            updated = await repository.UpdateAsync(proposed, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Outra gravação passou entre a leitura e o SaveChanges.
            updated = null;
        }

        return updated is not null
            ? (mapper.Map<TDto>(updated), false)
            : throw await ConflictWithLatest(ownerId, id, cancellationToken);
    }

    /// <summary>Regras que dependem de outros registros (ex.: o cliente do imóvel). Lança <c>ValidationException</c>.</summary>
    protected virtual Task ValidateAsync(TEntity proposed, Guid ownerId, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    /// <summary>
    /// Registro que não aceita mais <c>PUT</c> nem <c>DELETE</c> (ex.: vistoria concluída) → 409 <c>locked</c>.
    /// </summary>
    protected virtual bool IsLocked(TEntity current) => false;

    // O que impede escrever num registro vivo, antes da versão.
    private AppException? Refusal(Guid ownerId, TEntity current) =>
        current.OwnerId != ownerId ? new ForbiddenException()
        : IsLocked(current) ? new LockedException(mapper.Map<TDto>(current))
        : null;

    // Um id que não está vivo: excluído (de outro dono → 403, como no vivo) ou nunca criado (null, o upsert cria).
    private async Task<AppException?> TombstoneRefusal(Guid ownerId, Guid id, CancellationToken cancellationToken) =>
        await repository.FindTombstoneAsync(id, cancellationToken) switch
        {
            null => null,
            { } tombstone when tombstone.OwnerId != ownerId => new ForbiddenException(),
            { } tombstone => new DeletedException(tombstone.DeletedAt),
        };

    // ETag fraco, "*", lista de ETags ou base64 inválido não provam versão nenhuma: contam como diferentes.
    private byte[] BaseVersion(string? ifMatch, TEntity current)
    {
        if (string.IsNullOrEmpty(ifMatch))
        {
            throw new PreconditionRequiredException("If-Match");
        }

        if (!ETagHelper.TryParse(ifMatch, out var parsed) || !parsed.AsSpan().SequenceEqual(current.Version))
        {
            throw VersionConflictException.OnIfMatch(mapper.Map<TDto>(current));
        }

        return parsed;
    }

    // O vencedor da corrida pode ter só regravado, mas também travado ou excluído o registro.
    private async Task<AppException> ConflictWithLatest(Guid ownerId, Guid id, CancellationToken cancellationToken) =>
        await repository.FindByIdAsync(id, cancellationToken) is { } latest
            ? Conflict(ownerId, latest)
            : await TombstoneRefusal(ownerId, id, cancellationToken) ?? new NotFoundException();

    private AppException Conflict(Guid ownerId, TEntity latest) =>
        Refusal(ownerId, latest) ?? VersionConflictException.OnSave(mapper.Map<TDto>(latest));
}
