using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class GenericRepository<T>(AppDbContext db) : IRepository<T> where T : SyncEntity
{
    private static readonly string[] SoftDelete = [AppDbContext.SoftDeleteFilter];

    protected AppDbContext Db => db;

    protected DbSet<T> Set => db.Set<T>();

    public virtual Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        Set.AsNoTracking().SingleOrDefaultAsync(e => e.Id == id, cancellationToken);

    // Só o filtro de soft delete sai; um filtro de dono, quando vier, continua valendo.
    public Task<Tombstone?> FindTombstoneAsync(Guid id, CancellationToken cancellationToken) =>
        Set.IgnoreQueryFilters(SoftDelete)
            .Where(e => e.Id == id && e.DeletedAt != null)
            .Select(e => new Tombstone(e.OwnerId, e.DeletedAt!.Value))
            .SingleOrDefaultAsync(cancellationToken);

    public virtual async Task<T> AddAsync(T entity, CancellationToken cancellationToken)
    {
        Set.Add(entity);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException e) when (SqlErrors.IsUniqueViolation(e))
        {
            // Outra criação com o mesmo id gravou primeiro; sem o Detach, um próximo SaveChanges tentaria de novo.
            db.Entry(entity).State = EntityState.Detached;
            throw new DuplicateIdException(e);
        }

        return entity;
    }

    // Sem "update cego": a versão que o cliente leu vira o valor original do rowversion, e o EF põe no WHERE.
    // Se outra gravação passou na frente, nenhuma linha casa e o EF lança DbUpdateConcurrencyException.
    public virtual async Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken)
    {
        var current = await Set.SingleOrDefaultAsync(e => e.Id == entity.Id, cancellationToken);
        if (current is null)
        {
            return null;
        }

        var entry = db.Entry(current);
        entry.CurrentValues.SetValues(entity);
        entry.Property(e => e.Version).OriginalValue = entity.Version;
        // Regrava mesmo sem diferença: todo PUT aceito sobe a versão (ADR 0028). Sem isso, valores iguais deixariam
        // a entrada Unchanged, o SaveChanges não emitiria UPDATE e a versão-base nem seria conferida.
        entry.State = EntityState.Modified;
        await db.SaveChangesAsync(cancellationToken);
        return current;
    }

    // Só a raiz é carregada, sem Include: nenhum filho rastreado para o cascade do EF marcar junto.
    public async Task<bool> DeleteAsync(Guid id, byte[] version, CancellationToken cancellationToken)
    {
        var current = await Set.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (current is null)
        {
            return false;
        }

        // O AppDbContext transforma o Remove em DeletedAt = now; a versão-base vai no WHERE do UPDATE.
        db.Entry(current).Property(e => e.Version).OriginalValue = version;
        Set.Remove(current);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public virtual async Task<IReadOnlyList<T>> ChangedSinceAsync(
        Guid ownerId, byte[] afterVersion, int take, bool liveOnly, CancellationToken cancellationToken)
    {
        var query = ChangedSince(ownerId, afterVersion);
        if (liveOnly)
        {
            query = query.Where(e => e.DeletedAt == null);
        }

        return await query.OrderBy(e => e.Version).Take(take).ToListAsync(cancellationToken);
    }

    // O EF não compara byte[] com > nem conhece MIN_ACTIVE_ROWVERSION(), então o filtro da versão é SQL. O nome da
    // tabela vem do modelo, nunca de fora; dono e versão vão como parâmetros do FromSql. Sem o filtro de soft delete:
    // o tombstone também é mudança.
    protected IQueryable<T> ChangedSince(Guid ownerId, byte[] afterVersion)
    {
        var entity = db.Model.FindEntityType(typeof(T))!;
        var table = entity.GetSchema() is { } schema
            ? $"{Quote(schema)}.{Quote(entity.GetTableName()!)}"
            : Quote(entity.GetTableName()!);
        var sql = FormattableStringFactory.Create(
            $"SELECT * FROM {table} WHERE [OwnerId] = {{0}} AND [Version] > {{1}} AND [Version] < MIN_ACTIVE_ROWVERSION()",
            ownerId, afterVersion);
        return Set.FromSql(sql).IgnoreQueryFilters(SoftDelete).AsNoTracking();
    }

    private static string Quote(string name) => $"[{name.Replace("]", "]]")}]";
}
