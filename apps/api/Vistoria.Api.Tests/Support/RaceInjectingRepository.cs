using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Model;
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
public class RaceInjectingRepository<T> : IRepository<T> where T : SyncEntity
{
    private static readonly MethodInfo CloneMethod =
        typeof(object).GetMethod(nameof(MemberwiseClone), BindingFlags.Instance | BindingFlags.NonPublic)!;

    private readonly IRepository<T> _inner;
    private readonly RaceInjector _injector;
    private readonly IServiceScopeFactory _scopes;

    public RaceInjectingRepository(AppDbContext db, RaceInjector injector, IServiceScopeFactory scopes)
        : this(new GenericRepository<T>(db), injector, scopes)
    {
    }

    protected RaceInjectingRepository(IRepository<T> inner, RaceInjector injector, IServiceScopeFactory scopes)
    {
        _inner = inner;
        _injector = injector;
        _scopes = scopes;
    }

    public Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.FindByIdAsync(id, cancellationToken);

    public async Task<T> AddAsync(T entity, CancellationToken cancellationToken)
    {
        if (_injector.TakeAdd(entity.Id))
        {
            await using var scope = _scopes.CreateAsyncScope();
            var other = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            other.Set<T>().Add(CompetingCopy(entity));
            await other.SaveChangesAsync(cancellationToken);
        }

        return await _inner.AddAsync(entity, cancellationToken);
    }

    public async Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken)
    {
        if (_injector.TakeUpdate(entity.Id))
        {
            await using var scope = _scopes.CreateAsyncScope();
            var other = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Qualquer UPDATE sobe o rowversion.
            await other.Set<T>().Where(e => e.Id == entity.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.UpdatedAt, e => e.UpdatedAt), cancellationToken);
        }

        return await _inner.UpdateAsync(entity, cancellationToken);
    }

    public Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.DeleteAsync(id, cancellationToken);

    /// <summary>O registro que a outra requisição cria primeiro, com o mesmo id.</summary>
    protected virtual T CompetingCopy(T entity) => (T)CloneMethod.Invoke(entity, null)!;
}

/// <summary>
/// <see cref="RaceInjectingRepository{T}"/> sobre o <see cref="InspectionRepository"/>. A criação concorrente leva só a
/// raiz: com os mesmos ambientes e itens, a corrida seria pelos ids deles, não pelo da vistoria.
/// </summary>
public sealed class RaceInjectingInspectionRepository : RaceInjectingRepository<Inspection>, IInspectionRepository
{
    private readonly InspectionRepository _inner;

    public RaceInjectingInspectionRepository(AppDbContext db, RaceInjector injector, IServiceScopeFactory scopes)
        : this(new InspectionRepository(db), injector, scopes)
    {
    }

    private RaceInjectingInspectionRepository(
        InspectionRepository inner, RaceInjector injector, IServiceScopeFactory scopes)
        : base(inner, injector, scopes) => _inner = inner;

    public Task<IReadOnlySet<Guid>> FindChildIdsOfOtherInspectionsAsync(
        Guid inspectionId, IReadOnlyCollection<Guid> roomIds, IReadOnlyCollection<Guid> itemIds,
        CancellationToken cancellationToken) =>
        _inner.FindChildIdsOfOtherInspectionsAsync(inspectionId, roomIds, itemIds, cancellationToken);

    protected override Inspection CompetingCopy(Inspection entity)
    {
        var copy = base.CompetingCopy(entity);
        copy.Rooms = [];
        return copy;
    }
}
