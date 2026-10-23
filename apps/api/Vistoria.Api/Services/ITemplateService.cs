using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface ITemplateService
{
    /// <summary>Inexistente ou de outro dono → a mesma <c>NotFoundException</c>: o id de outro dono não vaza.</summary>
    Task<TemplateDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava o roteiro inteiro, com as mesmas regras de dono e de
    /// <paramref name="ifMatch"/> do <c>IClientService</c>. Ambiente ou item nulo, ou id repetido no roteiro →
    /// <c>ValidationException</c> no caminho do elemento, conferido depois da versão.
    /// </summary>
    Task<(TemplateDto Template, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertTemplateDto request, CancellationToken cancellationToken);
}
