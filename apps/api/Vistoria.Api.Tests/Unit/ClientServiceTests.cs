using AwesomeAssertions;
using MapsterMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Configurations;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;
using Vistoria.Api.Services.Impl;

namespace Vistoria.Api.Tests.Unit;

// A corrida entre ler e gravar não dá para provocar com duas requisições de forma determinística; o repositório
// falso faz outra gravação "passar na frente" no meio do UpdateAsync.
public class ClientServiceTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly IMapper Mapper =
        new ServiceCollection().AddMappings().BuildServiceProvider().GetRequiredService<IMapper>();

    [Fact]
    public async Task Upsert_WhenAnotherWriteWinsTheRace_Throws409VersionConflictWithTheCurrentRecord()
    {
        var ownerId = Guid.CreateVersion7();
        var repository = new RacingRepository(new Client
        {
            Id = Guid.CreateVersion7(),
            OwnerId = ownerId,
            Name = "Antes",
            Version = [0, 0, 0, 0, 0, 0, 0, 1],
        });
        var service = new ClientService(repository, Mapper);

        var act = () => service.UpsertAsync(ownerId, repository.Stored.Id, new UpsertClientDto { Name = "Meu" }, Ct);

        var conflict = (await act.Should().ThrowAsync<VersionConflictException>()).Which;
        conflict.Status.Should().Be(409);
        var current = conflict.Extensions["current"].Should().BeOfType<ClientDto>().Which;
        current.Name.Should().Be("Do outro aparelho");
        current.Version.Should().Be(Convert.ToBase64String([0, 0, 0, 0, 0, 0, 0, 2]));
    }

    private sealed class RacingRepository(Client stored) : IRepository<Client>
    {
        public Client Stored { get; private set; } = stored;

        public Task<Client?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult<Client?>(id == Stored.Id ? Stored : null);

        public Task<Client> AddAsync(Client entity, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<Client?> UpdateAsync(Client entity, CancellationToken cancellationToken)
        {
            Stored = new Client
            {
                Id = Stored.Id,
                OwnerId = Stored.OwnerId,
                Name = "Do outro aparelho",
                Version = [0, 0, 0, 0, 0, 0, 0, 2],
            };
            throw new DbUpdateConcurrencyException();
        }

        public Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
