using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface IPropertyService
{
    /// <summary>Inexistente ou de outro dono → a mesma <c>NotFoundException</c>: o id de outro dono não vaza.</summary>
    Task<PropertyDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava o imóvel. De outro dono → <c>ForbiddenException</c>; cliente
    /// inexistente ou de outro dono → <c>ValidationException</c> em <c>clientId</c>; corrida com outra gravação →
    /// <c>VersionConflictException</c> (409) com o registro atual.
    /// </summary>
    Task<(PropertyDto Property, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, UpsertPropertyDto request, CancellationToken cancellationToken);
}
