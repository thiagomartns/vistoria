using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories.Impl;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Regra do agregado (backend.md, "Entidade sincronizável"): ambiente e item não têm versão, e mudar qualquer um deles
// sobe a da vistoria. No SQL Server real, pelo DbContext, sem a API: DTO e endpoints são da #26.
public class InspectionAggregateTests(SyncDatabase database) : IClassFixture<SyncDatabase>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ChangingOnlyTheConditionOfOneItem_ChangesTheInspectionVersionAndUpdatedAt()
    {
        var created = await Create();
        database.Time.Advance(TimeSpan.FromMinutes(5));

        await Change(created.Id, i => i.Rooms.Single(r => r.Name == "Cozinha").Items.Single(it => it.Name == "Pia")
            .Condition = ItemCondition.Poor);

        var stored = await Read(created.Id);
        stored.Version.Should().NotEqual(created.Version);
        stored.UpdatedAt.Should().Be(database.Time.GetUtcNow()).And.NotBe(created.UpdatedAt);
        stored.CreatedAt.Should().Be(created.CreatedAt);
        stored.Rooms.SelectMany(r => r.Items).Single(it => it.Name == "Pia").Condition.Should().Be(ItemCondition.Poor);
        stored.Rooms.SelectMany(r => r.Items).Where(it => it.Name != "Pia")
            .Should().AllSatisfy(it => it.Condition.Should().Be(ItemCondition.Good));
    }

    [Fact]
    public async Task AddingARoom_ChangesTheInspectionVersion()
    {
        var created = await Create();

        await Change(created.Id, i => i.Rooms.Add(NewRoom("Quarto", 2, NewItem("Piso", 0))));

        var stored = await Read(created.Id);
        stored.Version.Should().NotEqual(created.Version);
        stored.Rooms.Select(r => r.Name).Should().Equal("Sala", "Cozinha", "Quarto");
    }

    [Fact]
    public async Task AddingAnItem_ChangesTheInspectionVersion()
    {
        var created = await Create();

        await Change(created.Id, i => i.Rooms.Single(r => r.Name == "Sala").Items.Add(NewItem("Tomadas", 2)));

        var stored = await Read(created.Id);
        stored.Version.Should().NotEqual(created.Version);
        stored.Rooms.Single(r => r.Name == "Sala").Items.Select(it => it.Name).Should().Equal("Piso", "Janelas", "Tomadas");
    }

    [Fact]
    public async Task RemovingAnItem_SoftDeletesIt_AndChangesTheInspectionVersion()
    {
        var created = await Create();
        var window = created.Rooms.Single(r => r.Name == "Sala").Items.Single(it => it.Name == "Janelas");

        await Change(created.Id, (i, db) => db.Remove(i.Rooms.SelectMany(r => r.Items).Single(it => it.Id == window.Id)));

        var stored = await Read(created.Id);
        stored.Version.Should().NotEqual(created.Version);
        stored.Rooms.SelectMany(r => r.Items).Should().NotContain(it => it.Id == window.Id);
        await using var db = database.CreateContext();
        var tombstone = await db.InspectionItems.IgnoreQueryFilters().SingleAsync(it => it.Id == window.Id, Ct);
        tombstone.DeletedAt.Should().Be(database.Time.GetUtcNow());
    }

    // Os itens rastreados de um ambiente removido entram no cascade do EF e viram soft delete com ele.
    [Fact]
    public async Task RemovingARoom_SoftDeletesItAndItsItems_AndChangesTheInspectionVersion()
    {
        var created = await Create();
        var kitchen = created.Rooms.Single(r => r.Name == "Cozinha");

        await Change(created.Id, (i, db) => db.Remove(i.Rooms.Single(r => r.Id == kitchen.Id)));

        var stored = await Read(created.Id);
        stored.Version.Should().NotEqual(created.Version);
        stored.Rooms.Select(r => r.Name).Should().Equal("Sala");
        await using var db = database.CreateContext();
        (await db.Rooms.IgnoreQueryFilters().SingleAsync(r => r.Id == kitchen.Id, Ct)).DeletedAt.Should().NotBeNull();
        var itemIds = kitchen.Items.Select(it => it.Id).ToList();
        (await db.InspectionItems.IgnoreQueryFilters().Where(it => itemIds.Contains(it.Id)).ToListAsync(Ct))
            .Should().HaveCount(2).And.AllSatisfy(it => it.DeletedAt.Should().NotBeNull());
    }

    [Fact]
    public async Task SavingWithoutChanges_KeepsTheVersion()
    {
        var created = await Create();

        await Change(created.Id, _ => { });

        (await Read(created.Id)).Version.Should().Equal(created.Version);
    }

    [Fact]
    public async Task FindById_IncludesOnlyLiveRoomsAndItems_OrderedByPosition()
    {
        var id = Guid.CreateVersion7();
        var deletedRoom = NewRoom("Varanda", 0, NewItem("Piso", 0));
        var deletedItem = NewItem("Lustre", 0);
        await Create(id, NewRoom("Cozinha", 3, NewItem("Pia", 1), deletedItem, NewItem("Armários", 0)),
            deletedRoom, NewRoom("Sala", 1, NewItem("Piso", 0)));
        await Change(id, (i, db) =>
        {
            db.Remove(i.Rooms.Single(r => r.Id == deletedRoom.Id));
            db.Remove(i.Rooms.SelectMany(r => r.Items).Single(it => it.Id == deletedItem.Id));
        });

        var stored = await Read(id);

        stored.Rooms.Select(r => r.Name).Should().Equal("Sala", "Cozinha");
        stored.Rooms[1].Items.Select(it => it.Name).Should().Equal("Armários", "Pia");
    }

    [Fact]
    public async Task Enums_AreStoredAsStrings()
    {
        var created = await Create();
        var itemId = created.Rooms[0].Items[0].Id;

        await using var db = database.CreateContext();
        var kind = await db.Database
            .SqlQuery<string>($"SELECT [Kind] AS [Value] FROM [inspections] WHERE [Id] = {created.Id}").SingleAsync(Ct);
        var status = await db.Database
            .SqlQuery<string>($"SELECT [Status] AS [Value] FROM [inspections] WHERE [Id] = {created.Id}").SingleAsync(Ct);
        var condition = await db.Database
            .SqlQuery<string>($"SELECT [Condition] AS [Value] FROM [inspection_items] WHERE [Id] = {itemId}")
            .SingleAsync(Ct);

        kind.Should().Be("MoveIn");
        status.Should().Be("InProgress");
        condition.Should().Be("Good");
    }

    // Sem a vistoria rastreada não há versão para subir: filho só é escrito pela raiz.
    [Fact]
    public async Task SavingAChildWithoutItsInspection_Throws_AndWritesNothing()
    {
        var created = await Create();
        var room = NewRoom("Quarto", 2);
        room.InspectionId = created.Id;
        var item = NewItem("Tomadas", 9);
        item.RoomId = created.Rooms[0].Id;

        foreach (var child in new object[] { room, item })
        {
            await using var db = database.CreateContext();
            db.Add(child);

            var act = () => db.SaveChangesAsync(Ct);

            await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("*sem a vistoria rastreada*");
        }

        var stored = await Read(created.Id);
        stored.Version.Should().Equal(created.Version);
        stored.Rooms.Should().HaveCount(2);
        stored.Rooms[0].Items.Should().HaveCount(2);
    }

    private async Task<Inspection> Create() =>
        await Create(Guid.CreateVersion7(),
            NewRoom("Sala", 0, NewItem("Piso", 0), NewItem("Janelas", 1)),
            NewRoom("Cozinha", 1, NewItem("Pia", 0), NewItem("Armários", 1)));

    private async Task<Inspection> Create(Guid id, params Room[] rooms)
    {
        var ownerId = Guid.CreateVersion7();
        var client = new Client { Id = Guid.CreateVersion7(), OwnerId = ownerId, Name = "Imobiliária" };
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
        await using (var db = database.CreateContext())
        {
            db.AddRange(client, property);
            db.Add(new Inspection
            {
                Id = id,
                OwnerId = ownerId,
                PropertyId = property.Id,
                Kind = InspectionKind.MoveIn,
                Status = InspectionStatus.InProgress,
                StartedAt = database.Time.GetUtcNow(),
                Rooms = [.. rooms],
            });
            await db.SaveChangesAsync(Ct);
        }

        return await Read(id);
    }

    private Task Change(Guid id, Action<Inspection> change) => Change(id, (i, _) => change(i));

    // Carrega o agregado rastreado, como o PUT da #26 vai fazer, aplica a mudança e grava.
    private async Task Change(Guid id, Action<Inspection, SyncTestDbContext> change)
    {
        await using var db = database.CreateContext();
        var inspection = await db.Inspections
            .Include(i => i.Rooms).ThenInclude(r => r.Items)
            .SingleAsync(i => i.Id == id, Ct);
        change(inspection, db);
        await db.SaveChangesAsync(Ct);
    }

    private async Task<Inspection> Read(Guid id)
    {
        await using var db = database.CreateContext();
        return (await new InspectionRepository(db).FindByIdAsync(id, Ct))!;
    }

    private static Room NewRoom(string name, int position, params InspectionItem[] items) =>
        new() { Id = Guid.CreateVersion7(), Name = name, Position = position, Items = [.. items] };

    private static InspectionItem NewItem(string name, int position) =>
        new() { Id = Guid.CreateVersion7(), Name = name, Position = position, Condition = ItemCondition.Good };
}
