using MapsterMapper;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class ClientService(IRepository<Client> clients, IMapper mapper)
    : SyncEntityService<Client, ClientDto>(clients, mapper), IClientService
{
    private readonly IMapper _mapper = mapper;

    public Task<(ClientDto Client, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertClientDto request, CancellationToken cancellationToken) =>
        UpsertAsync(ownerId, id, ifMatch, _mapper.Map<Client>(request), cancellationToken);
}
