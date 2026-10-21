using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface IClientService
{
    /// <summary>Inexistente ou de outro dono → a mesma <c>NotFoundException</c>: o id de outro dono não vaza.</summary>
    Task<ClientDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava o cliente. De outro dono → <c>ForbiddenException</c>; corrida
    /// com outra gravação → <c>VersionConflictException</c> (409) com o registro atual.
    /// </summary>
    Task<(ClientDto Client, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, UpsertClientDto request, CancellationToken cancellationToken);
}
