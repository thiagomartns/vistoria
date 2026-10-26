using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface IInspectionService
{
    /// <summary>Inexistente ou de outro dono → a mesma <c>NotFoundException</c>: o id de outro dono não vaza.</summary>
    Task<InspectionDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Cria (<c>Created</c> = <c>true</c>) ou regrava a vistoria com ambientes e itens, com as mesmas regras de dono e
    /// de <paramref name="ifMatch"/> do <c>IClientService</c>. Excluída → <c>DeletedException</c>; concluída →
    /// <c>LockedException</c>, antes da versão. Depois da versão, <c>ValidationException</c> no caminho do campo para:
    /// conclusão sem ambiente, ambiente sem item ou item sem condição, imóvel inexistente ou de outro dono, ambiente ou
    /// item nulo, e id repetido na vistoria ou já usado em outra. Concluir grava o <c>CompletedAt</c> do servidor.
    /// </summary>
    Task<(InspectionDto Inspection, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertInspectionDto request, CancellationToken cancellationToken);

    /// <summary>
    /// Soft delete da vistoria em andamento (só a raiz). Inexistente ou já excluída, de qualquer dono, só retorna.
    /// De outro dono → <c>ForbiddenException</c>; concluída → <c>LockedException</c>; depois, as regras de
    /// <paramref name="ifMatch"/> do upsert (428, 412) e 409 na corrida.
    /// </summary>
    Task DeleteAsync(Guid ownerId, Guid id, string? ifMatch, CancellationToken cancellationToken);
}
