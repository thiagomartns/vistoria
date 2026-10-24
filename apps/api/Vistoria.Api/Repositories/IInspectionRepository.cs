using Vistoria.Api.Model;

namespace Vistoria.Api.Repositories;

/// <summary>
/// <see cref="IRepository{T}"/> da vistoria com o agregado inteiro: <see cref="IRepository{T}.FindByIdAsync"/> traz
/// ambientes e itens vivos, cada lista em ordem de <c>position</c>. Os excluídos (soft delete) não aparecem.
/// <see cref="IRepository{T}.UpdateAsync"/> regrava as listas completas: id novo é criado, o que não veio é excluído,
/// e um excluído reenviado volta. <c>StartedAt</c>, <c>CompletedAt</c>, <c>ReferenceInspectionId</c> e a referência
/// dos itens ficam como estavam: a regravação não os toca.
/// </summary>
public interface IInspectionRepository : IRepository<Inspection>
{
    /// <summary>
    /// Os ids de <paramref name="roomIds"/> e <paramref name="itemIds"/> que já são de ambiente ou item de outra
    /// vistoria, de qualquer dono e inclusive excluídos: gravá-los nesta esbarraria na chave primária.
    /// </summary>
    Task<IReadOnlySet<Guid>> FindChildIdsOfOtherInspectionsAsync(
        Guid inspectionId, IReadOnlyCollection<Guid> roomIds, IReadOnlyCollection<Guid> itemIds,
        CancellationToken cancellationToken);
}
