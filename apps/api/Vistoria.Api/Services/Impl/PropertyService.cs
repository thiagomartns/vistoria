using MapsterMapper;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

// Mesmo fluxo do ClientService: o dono é conferido aqui, e If-Match e Idempotency-Key chegam no M2.
public class PropertyService(IRepository<Property> properties, IRepository<Client> clients, IMapper mapper)
    : IPropertyService
{
    public async Task<PropertyDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken)
    {
        var property = await properties.FindByIdAsync(id, cancellationToken);
        if (property is null || property.OwnerId != ownerId)
        {
            throw new NotFoundException();
        }

        return mapper.Map<PropertyDto>(property);
    }

    public async Task<(PropertyDto Property, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, UpsertPropertyDto request, CancellationToken cancellationToken)
    {
        var current = await properties.FindByIdAsync(id, cancellationToken);
        if (current is not null && current.OwnerId != ownerId)
        {
            throw new ForbiddenException();
        }

        // Cliente de outro dono responde igual ao inexistente, para o id dele não vazar. Cliente não é excluído na
        // V1, então ele não some entre esta leitura e o SaveChanges.
        var client = await clients.FindByIdAsync(request.ClientId!.Value, cancellationToken);
        if (client is null || client.OwnerId != ownerId)
        {
            throw new ValidationException("clientId", "Cliente não encontrado.");
        }

        var property = mapper.Map<Property>(request);
        property.Id = id;
        property.OwnerId = ownerId;

        if (current is null)
        {
            return (mapper.Map<PropertyDto>(await properties.AddAsync(property, cancellationToken)), true);
        }

        property.Version = current.Version;
        try
        {
            // Não volta null: imóvel não é excluído na V1, então o que acabou de ser lido continua lá.
            var updated = await properties.UpdateAsync(property, cancellationToken) ?? throw new NotFoundException();
            return (mapper.Map<PropertyDto>(updated), false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Outra gravação passou entre a leitura e o SaveChanges.
            var latest = await properties.FindByIdAsync(id, cancellationToken) ?? throw new NotFoundException();
            throw VersionConflictException.OnSave(mapper.Map<PropertyDto>(latest));
        }
    }
}
