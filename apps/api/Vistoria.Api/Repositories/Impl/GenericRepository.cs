using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class GenericRepository<T>(AppDbContext db) : IRepository<T> where T : SyncEntity
{
    private DbSet<T> Set => db.Set<T>();

    public Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        Set.AsNoTracking().SingleOrDefaultAsync(e => e.Id == id, cancellationToken);

    public async Task<T> AddAsync(T entity, CancellationToken cancellationToken)
    {
        Set.Add(entity);
        await db.SaveChangesAsync(cancellationToken);
        return entity;
    }

    // Sem "update cego": a versão que o cliente leu vira o valor original do rowversion, e o EF põe no WHERE.
    // Se outra gravação passou na frente, nenhuma linha casa e o EF lança DbUpdateConcurrencyException.
    public async Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken)
    {
        var current = await Set.SingleOrDefaultAsync(e => e.Id == entity.Id, cancellationToken);
        if (current is null)
        {
            return null;
        }

        var entry = db.Entry(current);
        entry.CurrentValues.SetValues(entity);
        entry.Property(e => e.Version).OriginalValue = entity.Version;
        await db.SaveChangesAsync(cancellationToken);
        return current;
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var current = await Set.SingleOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (current is null)
        {
            return false;
        }

        // O AppDbContext transforma o Remove em DeletedAt = now.
        Set.Remove(current);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
