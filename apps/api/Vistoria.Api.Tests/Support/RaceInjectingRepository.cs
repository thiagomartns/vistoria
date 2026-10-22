using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Repositories;
using Vistoria.Api.Repositories.Impl;

namespace Vistoria.Api.Tests.Support;

/// <summary>Qual id deve perder a corrida no próximo <c>AddAsync</c> ou <c>UpdateAsync</c>. Cada corrida dispara uma vez.</summary>
public sealed class RaceInjector
{
    private Guid? _add;
    private Guid? _update;

    public void LoseNextAdd(Guid id) => _add = id;

    public void LoseNextUpdate(Guid id) => _update = id;

    public bool TakeAdd(Guid id) => Take(ref _add, id);

    public bool TakeUpdate(Guid id) => Take(ref _update, id);

    private static bool Take(ref Guid? slot, Guid id)
    {
        if (slot != id)
        {
            return false;
        }

        slot = null;
        return true;
    }
}

/// <summary>
/// <see cref="GenericRepository{T}"/> com uma escrita concorrente de verdade, por outro <c>DbContext</c>, logo antes
/// de gravar: a criação do mesmo id (o SQL Server recusa a PK) ou uma regravação que sobe o rowversion. Torna
/// determinística a janela entre ler e gravar, que duas requisições paralelas só acertam por sorte.
/// </summary>
public sealed class RaceInjectingRepository<T>(
    AppDbContext db, RaceInjector injector, IServiceScopeFactory scopes) : IRepository<T> where T : SyncEntity
{
    private static readonly MethodInfo CloneMethod =
        typeof(object).GetMethod(nameof(MemberwiseClone), BindingFlags.Instance | BindingFlags.NonPublic)!;

    private readonly GenericRepository<T> _inner = new(db);

    public Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.FindByIdAsync(id, cancellationToken);

    public async Task<T> AddAsync(T entity, CancellationToken cancellationToken)
    {
        if (injector.TakeAdd(entity.Id))
        {
            await using var scope = scopes.CreateAsyncScope();
            var other = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            other.Set<T>().Add((T)CloneMethod.Invoke(entity, null)!);
            await other.SaveChangesAsync(cancellationToken);
        }

        return await _inner.AddAsync(entity, cancellationToken);
    }

    public async Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken)
    {
        if (injector.TakeUpdate(entity.Id))
        {
            await using var scope = scopes.CreateAsyncScope();
            var other = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Qualquer UPDATE sobe o rowversion.
            await other.Set<T>().Where(e => e.Id == entity.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.UpdatedAt, e => e.UpdatedAt), cancellationToken);
        }

        return await _inner.UpdateAsync(entity, cancellationToken);
    }

    public Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.DeleteAsync(id, cancellationToken);
}
