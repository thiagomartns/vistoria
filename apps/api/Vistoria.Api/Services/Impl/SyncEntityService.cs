using MapsterMapper;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Repositories;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Services.Impl;

/// <summary>
/// <c>GET</c> e <c>PUT</c> (upsert) de uma <see cref="SyncEntity"/> sem filhos, na ordem de backend.md, "Sync →
/// Escrita": dono, versão (<c>If-Match</c>), regras da entidade (<see cref="ValidateAsync"/>) e gravação. O dono é
/// conferido aqui, não num filtro global: o <c>PUT</c> precisa distinguir "de outro dono" (403) de "não existe" (cria).
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
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava <paramref name="proposed"/>. Na criação o <c>If-Match</c> é
    /// ignorado; num registro existente ele é obrigatório (428) e precisa ser a versão atual (412). Corrida com
    /// outra gravação → 409 <c>version-conflict</c> com o registro atual.
    /// </summary>
    protected async Task<(TDto Dto, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, TEntity proposed, CancellationToken cancellationToken)
    {
        var current = await repository.FindByIdAsync(id, cancellationToken);
        if (current is not null && current.OwnerId != ownerId)
        {
            throw new ForbiddenException();
        }

        byte[]? baseVersion = null;
        if (current is not null)
        {
            if (string.IsNullOrEmpty(ifMatch))
            {
                throw new PreconditionRequiredException("If-Match");
            }

            // ETag fraco, "*", lista de ETags ou base64 inválido não provam versão nenhuma: contam como diferentes.
            if (!ETagHelper.TryParse(ifMatch, out var parsed) || !parsed.AsSpan().SequenceEqual(current.Version))
            {
                throw VersionConflictException.OnIfMatch(mapper.Map<TDto>(current));
            }

            baseVersion = parsed;
        }

        await ValidateAsync(proposed, ownerId, cancellationToken);

        proposed.Id = id;
        proposed.OwnerId = ownerId;

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
        try
        {
            // Não volta null: nada é excluído por este caminho, então o que acabou de ser lido continua lá.
            var updated = await repository.UpdateAsync(proposed, cancellationToken) ?? throw new NotFoundException();
            return (mapper.Map<TDto>(updated), false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Outra gravação passou entre a leitura e o SaveChanges.
            throw await ConflictWithLatest(ownerId, id, cancellationToken);
        }
    }

    /// <summary>Regras que dependem de outros registros (ex.: o cliente do imóvel). Lança <c>ValidationException</c>.</summary>
    protected virtual Task ValidateAsync(TEntity proposed, Guid ownerId, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    private async Task<AppException> ConflictWithLatest(Guid ownerId, Guid id, CancellationToken cancellationToken)
    {
        var latest = await repository.FindByIdAsync(id, cancellationToken) ?? throw new NotFoundException();
        return latest.OwnerId == ownerId
            ? VersionConflictException.OnSave(mapper.Map<TDto>(latest))
            : new ForbiddenException();
    }
}
