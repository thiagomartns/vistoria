using MapsterMapper;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class PropertyService(IRepository<Property> properties, IRepository<Client> clients, IMapper mapper)
    : SyncEntityService<Property, PropertyDto>(properties, mapper), IPropertyService
{
    private readonly IMapper _mapper = mapper;

    public Task<(PropertyDto Property, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertPropertyDto request, CancellationToken cancellationToken) =>
        UpsertAsync(ownerId, id, ifMatch, _mapper.Map<Property>(request), cancellationToken);

    // Cliente de outro dono responde igual ao inexistente, para o id dele não vazar. Cliente não é excluído na V1,
    // então ele não some entre esta leitura e o SaveChanges.
    protected override async Task ValidateAsync(Property proposed, Guid ownerId, CancellationToken cancellationToken)
    {
        var client = await clients.FindByIdAsync(proposed.ClientId, cancellationToken);
        if (client is null || client.OwnerId != ownerId)
        {
            throw new ValidationException("clientId", "Cliente não encontrado.");
        }
    }
}
