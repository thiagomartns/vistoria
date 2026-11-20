using MapsterMapper;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Validation;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class ClientService(IRepository<Client> clients, IMapper mapper)
    : SyncEntityService<Client, ClientDto>(clients, mapper), IClientService
{
    private readonly IMapper _mapper = mapper;

    public Task<(ClientDto Client, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertClientDto request, CancellationToken cancellationToken)
    {
        var client = _mapper.Map<Client>(request);
        // O [Telefone] já validou a entrada normalizada; o banco guarda o canônico, só com dígitos (ADR 0063).
        client.Phone = TelefoneAttribute.Normalize(client.Phone);
        return UpsertAsync(ownerId, id, ifMatch, client, cancellationToken);
    }
}
