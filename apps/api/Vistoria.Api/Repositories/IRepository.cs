using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Repositories;

/// <summary>Acesso genérico a uma <see cref="SyncEntity"/>. Registros excluídos (soft delete) não aparecem.</summary>
public interface IRepository<T> where T : SyncEntity
{
    Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Grava o registro novo; volta com <see cref="SyncEntity.Version"/> e as datas do servidor.</summary>
    Task<T> AddAsync(T entity, CancellationToken cancellationToken);

    /// <summary>
    /// Regrava o registro a partir da versão em <paramref name="entity"/>.<see cref="SyncEntity.Version"/>, mesmo
    /// sem diferença, então a versão sempre sobe (ADR 0028). Se ela não for mais a do banco, lança
    /// <see cref="DbUpdateConcurrencyException"/>. Devolve <c>null</c> se o registro não existe ou foi excluído.
    /// </summary>
    Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken);

    /// <summary>Soft delete (<see cref="SyncEntity.DeletedAt"/>). Devolve <c>false</c> se não existe ou já foi excluído.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken);
}
