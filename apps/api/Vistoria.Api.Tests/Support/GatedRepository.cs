using System.Collections.Concurrent;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Repositories;
using Vistoria.Api.Repositories.Impl;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// Controla a próxima gravação de um id: segurá-la até o teste soltar (uma requisição "em processamento" pelo tempo
/// que o teste quiser) ou fazê-la falhar com uma exceção fora do catálogo (500). Cada regra dispara uma vez.
/// </summary>
public sealed class WriteGate
{
    private readonly ConcurrentDictionary<Guid, Hold> _holds = new();
    private readonly ConcurrentDictionary<Guid, byte> _failures = new();

    public Hold HoldNext(Guid id) => _holds[id] = new Hold();

    public void FailNext(Guid id) => _failures[id] = 0;

    public async Task PassAsync(Guid id, CancellationToken cancellationToken)
    {
        if (_failures.TryRemove(id, out _))
        {
            throw new InvalidOperationException("Falha injetada pelo teste.");
        }

        if (_holds.TryRemove(id, out var hold))
        {
            hold.Arrive();
            await hold.Released.WaitAsync(cancellationToken);
        }
    }

    public sealed class Hold
    {
        private readonly TaskCompletionSource _entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);

        /// <summary>Completa quando a gravação chegou ao portão: a chave já está gravada como <c>processing</c>.</summary>
        public Task Entered => _entered.Task;

        internal Task Released => _released.Task;

        internal void Arrive() => _entered.TrySetResult();

        public void Release() => _released.TrySetResult();
    }
}

/// <summary><see cref="GenericRepository{T}"/> que passa pelo <see cref="WriteGate"/> antes de cada gravação.</summary>
public class GatedRepository<T> : IRepository<T> where T : SyncEntity
{
    private readonly IRepository<T> _inner;
    private readonly WriteGate _gate;

    public GatedRepository(AppDbContext db, WriteGate gate)
        : this(new GenericRepository<T>(db), gate)
    {
    }

    protected GatedRepository(IRepository<T> inner, WriteGate gate)
    {
        _inner = inner;
        _gate = gate;
    }

    public Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.FindByIdAsync(id, cancellationToken);

    public async Task<T> AddAsync(T entity, CancellationToken cancellationToken)
    {
        await _gate.PassAsync(entity.Id, cancellationToken);
        return await _inner.AddAsync(entity, cancellationToken);
    }

    public async Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken)
    {
        await _gate.PassAsync(entity.Id, cancellationToken);
        return await _inner.UpdateAsync(entity, cancellationToken);
    }

    public Task<Tombstone?> FindTombstoneAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.FindTombstoneAsync(id, cancellationToken);

    public async Task<bool> DeleteAsync(Guid id, byte[] version, CancellationToken cancellationToken)
    {
        await _gate.PassAsync(id, cancellationToken);
        return await _inner.DeleteAsync(id, version, cancellationToken);
    }

    public Task<IReadOnlyList<T>> ChangedSinceAsync(
        Guid ownerId, byte[] afterVersion, int take, bool liveOnly, CancellationToken cancellationToken) =>
        _inner.ChangedSinceAsync(ownerId, afterVersion, take, liveOnly, cancellationToken);
}

/// <summary><see cref="GatedRepository{T}"/> sobre o <see cref="InspectionRepository"/>.</summary>
public sealed class GatedInspectionRepository : GatedRepository<Inspection>, IInspectionRepository
{
    private readonly InspectionRepository _inner;

    public GatedInspectionRepository(AppDbContext db, WriteGate gate)
        : this(new InspectionRepository(db), gate)
    {
    }

    private GatedInspectionRepository(InspectionRepository inner, WriteGate gate)
        : base(inner, gate) => _inner = inner;

    public Task<IReadOnlySet<Guid>> FindChildIdsOfOtherInspectionsAsync(
        Guid inspectionId, IReadOnlyCollection<Guid> roomIds, IReadOnlyCollection<Guid> itemIds,
        CancellationToken cancellationToken) =>
        _inner.FindChildIdsOfOtherInspectionsAsync(inspectionId, roomIds, itemIds, cancellationToken);
}
