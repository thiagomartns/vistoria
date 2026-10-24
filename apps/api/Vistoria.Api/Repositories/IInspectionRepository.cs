using Vistoria.Api.Model;

namespace Vistoria.Api.Repositories;

/// <summary>
/// <see cref="IRepository{T}"/> da vistoria com o agregado inteiro: <see cref="IRepository{T}.FindByIdAsync"/> traz
/// ambientes e itens vivos, cada lista em ordem de <c>position</c>. Os excluídos (soft delete) não aparecem.
/// </summary>
public interface IInspectionRepository : IRepository<Inspection>;
