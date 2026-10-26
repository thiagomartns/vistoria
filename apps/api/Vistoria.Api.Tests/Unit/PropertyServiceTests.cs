using AwesomeAssertions;
using MapsterMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Configurations;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Repositories;
using Vistoria.Api.Services.Impl;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Tests.Unit;

// Como no ClientServiceTests: o repositório falso faz outra gravação "passar na frente" no meio do UpdateAsync.
public class PropertyServiceTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly IMapper Mapper =
        new ServiceCollection().AddMappings().BuildServiceProvider().GetRequiredService<IMapper>();

    [Fact]
    public async Task Upsert_WhenAnotherWriteWinsTheRace_Throws409VersionConflictWithTheCurrentRecord()
    {
        var ownerId = Guid.CreateVersion7();
        var client = new Client { Id = Guid.CreateVersion7(), OwnerId = ownerId, Name = "Imobiliária" };
        var repository = new RacingRepository(new Property
        {
            Id = Guid.CreateVersion7(),
            OwnerId = ownerId,
            ClientId = client.Id,
            Street = "Antes",
            Version = [0, 0, 0, 0, 0, 0, 0, 1],
        });
        var service = new PropertyService(repository, new SingleRepository<Client>(client), Mapper);
        var request = new UpsertPropertyDto
        {
            ClientId = client.Id,
            Street = "Minha",
            Number = "1",
            District = "Centro",
            City = "Recife",
            State = "PE",
            ZipCode = "50010000",
            Type = PropertyType.House,
        };

        var act = () => service.UpsertAsync(
            ownerId, repository.Stored.Id, ETagHelper.ToETag(repository.Stored.Version), request, Ct);

        var conflict = (await act.Should().ThrowAsync<VersionConflictException>()).Which;
        conflict.Status.Should().Be(409);
        var current = conflict.Extensions["current"].Should().BeOfType<PropertyDto>().Which;
        current.Street.Should().Be("Do outro aparelho");
        current.Version.Should().Be(Convert.ToBase64String([0, 0, 0, 0, 0, 0, 0, 2]));
    }

    private sealed class RacingRepository(Property stored) : SingleRepository<Property>(stored)
    {
        public override Task<Property?> UpdateAsync(Property entity, CancellationToken cancellationToken)
        {
            Stored = new Property
            {
                Id = Stored.Id,
                OwnerId = Stored.OwnerId,
                ClientId = Stored.ClientId,
                Street = "Do outro aparelho",
                Version = [0, 0, 0, 0, 0, 0, 0, 2],
            };
            throw new DbUpdateConcurrencyException();
        }
    }

    private class SingleRepository<T>(T stored) : IRepository<T> where T : SyncEntity
    {
        public T Stored { get; protected set; } = stored;

        public Task<T?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(id == Stored.Id ? Stored : null);

        public Task<T> AddAsync(T entity, CancellationToken cancellationToken) => throw new NotSupportedException();

        public virtual Task<T?> UpdateAsync(T entity, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<Tombstone?> FindTombstoneAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult<Tombstone?>(null);

        public Task<bool> DeleteAsync(Guid id, byte[] version, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
