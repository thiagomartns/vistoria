using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface IPropertyService
{
    /// <summary>Inexistente ou de outro dono → a mesma <c>NotFoundException</c>: o id de outro dono não vaza.</summary>
    Task<PropertyDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava o imóvel, com as mesmas regras de dono e de
    /// <paramref name="ifMatch"/> do <c>IClientService</c>. Cliente inexistente ou de outro dono →
    /// <c>ValidationException</c> em <c>clientId</c>, conferido depois da versão.
    /// </summary>
    Task<(PropertyDto Property, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertPropertyDto request, CancellationToken cancellationToken);
}
