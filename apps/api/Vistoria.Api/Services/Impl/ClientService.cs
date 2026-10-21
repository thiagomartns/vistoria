using MapsterMapper;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

// O dono é conferido aqui, não num filtro global: o PUT precisa distinguir "de outro dono" (403) de "não existe"
// (cria). If-Match e Idempotency-Key chegam no M2; até lá o PUT regrava sobre a versão atual.
public class ClientService(IRepository<Client> clients, IMapper mapper) : IClientService
{
    public async Task<ClientDto> GetAsync(Guid ownerId, Guid id, CancellationToken cancellationToken)
    {
        var client = await clients.FindByIdAsync(id, cancellationToken);
        if (client is null || client.OwnerId != ownerId)
        {
            throw new NotFoundException();
        }

        return mapper.Map<ClientDto>(client);
    }

    public async Task<(ClientDto Client, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, UpsertClientDto request, CancellationToken cancellationToken)
    {
        var current = await clients.FindByIdAsync(id, cancellationToken);
        if (current is not null && current.OwnerId != ownerId)
        {
            throw new ForbiddenException();
        }

        var client = mapper.Map<Client>(request);
        client.Id = id;
        client.OwnerId = ownerId;

        if (current is null)
        {
            return (mapper.Map<ClientDto>(await clients.AddAsync(client, cancellationToken)), true);
        }

        client.Version = current.Version;
        try
        {
            // Não volta null: cliente não é excluído na V1, então o que acabou de ser lido continua lá.
            var updated = await clients.UpdateAsync(client, cancellationToken) ?? throw new NotFoundException();
            return (mapper.Map<ClientDto>(updated), false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Outra gravação passou entre a leitura e o SaveChanges.
            var latest = await clients.FindByIdAsync(id, cancellationToken) ?? throw new NotFoundException();
            throw VersionConflictException.OnSave(mapper.Map<ClientDto>(latest));
        }
    }
}
