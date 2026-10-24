using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface IInspectionService
{
    /// <summary>Inexistente ou de outro dono → a mesma <c>NotFoundException</c>: o id de outro dono não vaza.</summary>
    Task<InspectionDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava a vistoria com ambientes e itens, com as mesmas regras de dono e
    /// de <paramref name="ifMatch"/> do <c>IClientService</c>. Depois da versão, <c>ValidationException</c> no
    /// caminho do campo para: conclusão (ainda não existe), imóvel inexistente ou de outro dono, ambiente ou item
    /// nulo, e id repetido na vistoria ou já usado em outra.
    /// </summary>
    Task<(InspectionDto Inspection, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertInspectionDto request, CancellationToken cancellationToken);
}
