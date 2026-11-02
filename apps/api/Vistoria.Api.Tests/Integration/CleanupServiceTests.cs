using System.Net;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Configurations;
using Vistoria.Api.Infrastructure.Background;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Banco próprio: a limpeza apaga as chaves e os tombstones vencidos de todo mundo, e no banco compartilhado apagaria os
// dos outros testes. Os testes daqui avançam o relógio da factory, então cada um mede a partir do "agora" dele.
public class CleanupServiceTests(CleanupServiceTests.OwnDatabaseFactory factory)
    : IClassFixture<CleanupServiceTests.OwnDatabaseFactory>
{
    public class OwnDatabaseFactory : ApiFactory
    {
        public string Name { get; } = $"vistoria_cleanup_{Guid.NewGuid():N}";

        protected override string Database => Name;
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    // Várias rodadas, para as duas instâncias de fato disputarem as mesmas linhas, nas duas tabelas e na cascata.
    [Fact]
    public async Task TwoInstancesAtTheSameTime_RemoveEachExpiredRowOnce_AndKeepTheValidOnes()
    {
        await using var otherHost = factory.WithWebHostBuilder(_ => { });
        var instances = new[] { Cleanup(factory), Cleanup(otherHost) };
        // O que outro teste deixou e venceu quando ele avançou o relógio não entra na conta.
        await instances[0].RunOnceAsync(Ct);

        var now = factory.Time.GetUtcNow();
        var propertyId = await SeedProperty();
        for (var round = 0; round < 5; round++)
        {
            var expiredKeys = await SeedKeys(200, now - IdempotencyConfig.KeyValidity - TimeSpan.FromSeconds(1));
            // No limite exato a chave ainda vale, como no IdempotencyFilter.
            var validKeys = await SeedKeys(20, now - IdempotencyConfig.KeyValidity);
            var expired = await SeedInspections(
                propertyId, 100, now - SyncConfig.TombstoneRetention - TimeSpan.FromSeconds(1));
            var young = await SeedInspections(propertyId, 10, now - SyncConfig.TombstoneRetention);

            var results = await Task.WhenAll(instances.Select(i => i.RunOnceAsync(Ct)));

            results.Sum(r => r.Keys).Should().Be(expiredKeys.Count);
            results.Sum(r => r.Tombstones).Should().Be(expired.Count);
            (await RemainingKeys(expiredKeys)).Should().BeEmpty();
            (await RemainingKeys(validKeys)).Should().BeEquivalentTo(validKeys);
            (await Remaining(expired)).Should().Be(new Rows(0, 0, 0));
            (await Remaining(young)).Should().Be(Rows.Of(young));
        }
    }

    // Retenção de SyncConfig, a mesma do cursor-expired, com o mesmo limite: no instante exato ainda fica.
    [Fact]
    public async Task ExpiredTombstone_IsPurgedWithRoomsAndItems_AndTheOthersStayAsTheyWere()
    {
        var now = factory.Time.GetUtcNow();
        var propertyId = await SeedProperty();
        var expired = await SeedInspections(
            propertyId, 1, now - SyncConfig.TombstoneRetention - TimeSpan.FromSeconds(1));
        var atTheLimit = await SeedInspections(propertyId, 1, now - SyncConfig.TombstoneRetention);
        var young = await SeedInspections(propertyId, 1, now - TimeSpan.FromDays(1));
        // Viva, com um ambiente e um item excluídos há muito: filhos de vistoria viva não são limpos (ADR 0049).
        var live = await SeedInspections(
            propertyId, 1, deletedAt: null, childrenDeletedAt: now - SyncConfig.TombstoneRetention * 2);
        var liveVersion = await VersionOf(live[0].Id);
        var validKeys = await SeedKeys(3, now - TimeSpan.FromDays(1));

        await Cleanup(factory).RunOnceAsync(Ct);

        (await Remaining(expired)).Should().Be(new Rows(0, 0, 0));
        (await Remaining(atTheLimit)).Should().Be(Rows.Of(atTheLimit));
        (await Remaining(young)).Should().Be(Rows.Of(young));
        (await Remaining(live)).Should().Be(Rows.Of(live));
        (await VersionOf(live[0].Id)).Should().Equal(liveVersion);
        (await RemainingKeys(validKeys)).Should().BeEquivalentTo(validKeys);
    }

    // O FK da referência é Restrict: a linha referenciada derrubaria o DELETE inteiro, e nenhuma outra sairia.
    [Fact]
    public async Task ReferencedTombstone_Stays_AndDoesNotBlockTheOthers()
    {
        var now = factory.Time.GetUtcNow();
        var propertyId = await SeedProperty();
        var cutoff = now - SyncConfig.TombstoneRetention - TimeSpan.FromSeconds(1);
        var referenced = await SeedInspections(propertyId, 1, cutoff);
        var other = await SeedInspections(propertyId, 1, cutoff);
        await SeedInspections(propertyId, 1, deletedAt: null, referenceId: referenced[0].Id);

        await Cleanup(factory).RunOnceAsync(Ct);

        (await Remaining(referenced)).Should().Be(Rows.Of(referenced));
        (await Remaining(other)).Should().Be(new Rows(0, 0, 0));
    }

    // Depois da purga não há tombstone para responder 410: o PUT cria de novo. Quem ainda tinha a vistoria e ficou
    // 90 dias sem sincronizar recebe cursor-expired e refaz o sync (ADR 0049).
    [Fact]
    public async Task PutOnAPurgedId_CreatesTheInspectionAgain()
    {
        var userId = Guid.CreateVersion7();
        var client = factory.CreateAuthenticatedClient(userId);
        var id = Guid.CreateVersion7();
        var body = await NewBody(client);
        (await client.SendAsync(WriteRequests.Put(PathOf(id), body), Ct)).StatusCode.Should().Be(HttpStatusCode.Created);
        var get = await client.GetAsync(PathOf(id), Ct);
        var delete = WriteRequests.Delete(PathOf(id));
        delete.Headers.TryAddWithoutValidation("If-Match", get.Headers.ETag!.Tag);
        (await client.SendAsync(delete, Ct)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        factory.Time.Advance(SyncConfig.TombstoneRetention);
        await Cleanup(factory).RunOnceAsync(Ct);
        client = factory.CreateAuthenticatedClient(userId);
        (await client.SendAsync(WriteRequests.Put(PathOf(id), body), Ct)).StatusCode.Should().Be(HttpStatusCode.Gone);

        factory.Time.Advance(TimeSpan.FromSeconds(1));
        await Cleanup(factory).RunOnceAsync(Ct);
        client = factory.CreateAuthenticatedClient(userId);
        (await client.SendAsync(WriteRequests.Put(PathOf(id), body), Ct)).StatusCode.Should().Be(HttpStatusCode.Created);
    }

    private sealed record Seeded(Guid Id, Guid RoomId, Guid ItemId);

    private sealed record Rows(int Inspections, int Rooms, int Items)
    {
        // Cada vistoria semeada tem um ambiente com um item.
        public static Rows Of(List<Seeded> seeded) => new(seeded.Count, seeded.Count, seeded.Count);
    }

    private static CleanupService Cleanup(WebApplicationFactory<Program> host) =>
        host.Services.GetRequiredService<CleanupService>();

    private async Task<T> WithDb<T>(Func<AppDbContext, Task<T>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    private Task<Guid> SeedProperty() => WithDb(async db =>
    {
        var ownerId = Guid.CreateVersion7();
        var client = new Client { Id = Guid.CreateVersion7(), OwnerId = ownerId, Name = "Maria Locadora" };
        var property = new Property
        {
            Id = Guid.CreateVersion7(),
            OwnerId = ownerId,
            ClientId = client.Id,
            Street = "Rua Direita",
            Number = "10",
            District = "Centro",
            City = "Salvador",
            State = "BA",
            ZipCode = "40020000",
            Type = PropertyType.Apartment,
        };
        db.AddRange(client, property);
        await db.SaveChangesAsync(Ct);
        return property.Id;
    });

    // Vistorias com um ambiente e um item cada. O DeletedAt de um Added não é tocado pelo SaveChanges.
    private Task<List<Seeded>> SeedInspections(
        Guid propertyId, int count, DateTimeOffset? deletedAt, DateTimeOffset? childrenDeletedAt = null,
        Guid? referenceId = null) => WithDb(async db =>
    {
        var inspections = Enumerable.Range(0, count).Select(_ =>
        {
            var inspection = new Inspection
            {
                Id = Guid.CreateVersion7(),
                OwnerId = Guid.CreateVersion7(),
                PropertyId = propertyId,
                Kind = InspectionKind.MoveIn,
                Status = InspectionStatus.InProgress,
                ReferenceInspectionId = referenceId,
                StartedAt = factory.Time.GetUtcNow(),
                DeletedAt = deletedAt,
            };
            var room = new Room
            {
                Id = Guid.CreateVersion7(), InspectionId = inspection.Id, Name = "Sala", DeletedAt = childrenDeletedAt,
            };
            room.Items.Add(new InspectionItem
            {
                Id = Guid.CreateVersion7(), RoomId = room.Id, Name = "Piso", DeletedAt = childrenDeletedAt,
            });
            inspection.Rooms.Add(room);
            return inspection;
        }).ToList();
        db.Inspections.AddRange(inspections);
        await db.SaveChangesAsync(Ct);
        return inspections.Select(i => new Seeded(i.Id, i.Rooms[0].Id, i.Rooms[0].Items[0].Id)).ToList();
    });

    // Vivas e excluídas: a limpeza é física, e o filtro de soft delete esconderia o que sobrou.
    private Task<Rows> Remaining(List<Seeded> seeded) => WithDb(async db =>
    {
        var ids = seeded.Select(s => s.Id).ToList();
        var roomIds = seeded.Select(s => s.RoomId).ToList();
        var itemIds = seeded.Select(s => s.ItemId).ToList();
        return new Rows(
            await db.Inspections.IgnoreQueryFilters().CountAsync(i => ids.Contains(i.Id), Ct),
            await db.Rooms.IgnoreQueryFilters().CountAsync(r => roomIds.Contains(r.Id), Ct),
            await db.InspectionItems.IgnoreQueryFilters().CountAsync(it => itemIds.Contains(it.Id), Ct));
    });

    private Task<byte[]> VersionOf(Guid id) => WithDb(db =>
        db.Inspections.IgnoreQueryFilters().Where(i => i.Id == id).Select(i => i.Version).SingleAsync(Ct));

    private Task<List<Guid>> SeedKeys(int count, DateTimeOffset createdAt) => WithDb(async db =>
    {
        var records = Enumerable.Range(0, count).Select(_ => new IdempotencyRecord
        {
            UserId = Guid.CreateVersion7(),
            Key = Guid.CreateVersion7(),
            RequestHash = new byte[32],
            State = IdempotencyState.Done,
            StatusCode = 201,
            CreatedAt = createdAt,
        }).ToList();
        db.IdempotencyRecords.AddRange(records);
        await db.SaveChangesAsync(Ct);
        return records.Select(r => r.Key).ToList();
    });

    private Task<List<Guid>> RemainingKeys(List<Guid> keys) => WithDb(db =>
        db.IdempotencyRecords.Where(r => keys.Contains(r.Key)).Select(r => r.Key).ToListAsync(Ct));

    private static string PathOf(Guid id) => $"/api/v1/inspections/{id}";

    private static async Task<object> NewBody(HttpClient client)
    {
        var clientId = Guid.CreateVersion7();
        (await client.SendAsync(WriteRequests.Put($"/api/v1/clients/{clientId}", new { name = "Maria Locadora" }), Ct))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        var propertyId = Guid.CreateVersion7();
        (await client.SendAsync(WriteRequests.Put($"/api/v1/properties/{propertyId}", new
        {
            clientId,
            street = "Rua Direita",
            number = "10",
            district = "Centro",
            city = "Salvador",
            state = "BA",
            zipCode = "40020000",
            type = "apartment",
        }), Ct)).StatusCode.Should().Be(HttpStatusCode.Created);
        return new
        {
            propertyId,
            kind = "moveIn",
            status = "inProgress",
            startedAt = ApiFactory.Start,
            rooms = new[]
            {
                new
                {
                    id = Guid.CreateVersion7(),
                    name = "Sala",
                    position = 0,
                    items = new[] { new { id = Guid.CreateVersion7(), name = "Piso", position = 0 } },
                },
            },
        };
    }
}
