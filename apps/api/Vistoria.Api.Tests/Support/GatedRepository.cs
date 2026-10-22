using System.Collections.Concurrent;
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
public sealed class GatedRepository<T>(AppDbContext db, WriteGate gate) : IRepository<T> where T : SyncEntity
{
    private readonly GenericRepository<T> _inner = new(db);

    public Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.FindByIdAsync(id, cancellationToken);

    public async Task<T> AddAsync(T entity, CancellationToken cancellationToken)
    {
        await gate.PassAsync(entity.Id, cancellationToken);
        return await _inner.AddAsync(entity, cancellationToken);
    }

    public async Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken)
    {
        await gate.PassAsync(entity.Id, cancellationToken);
        return await _inner.UpdateAsync(entity, cancellationToken);
    }

    public Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken) =>
        _inner.DeleteAsync(id, cancellationToken);
}
