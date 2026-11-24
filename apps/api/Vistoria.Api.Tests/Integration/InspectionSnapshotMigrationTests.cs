using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

/// <summary>
/// A migração da cópia da conclusão (ADR 0068), num banco próprio parado na migração de antes: a concluída ganha o
/// imóvel e o cliente de hoje, e o rowversion dela sobe (o delta a reenvia); a vistoria em andamento fica sem cópia e
/// com a mesma versão.
/// </summary>
public class InspectionSnapshotMigrationTests
{
    private const string Before = "20261120132901_NormalizeClientPhones";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Migration_CopiesTodaysPropertyAndClient_IntoTheCompletedOnly()
    {
        var connectionString = await SqlServerContainer.ConnectionStringAsync($"vistoria_snapshot_{Guid.NewGuid():N}");
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options;
        await using var db = new AppDbContext(options, TimeProvider.System);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(Before, cancellationToken: Ct);

        var ownerId = Guid.CreateVersion7();
        var clientId = Guid.CreateVersion7();
        var propertyId = Guid.CreateVersion7();
        var completedId = Guid.CreateVersion7();
        var inProgressId = Guid.CreateVersion7();
        await db.Database.ExecuteSqlAsync(
            $"""
            INSERT INTO clients (Id, Name, Document, CreatedAt, UpdatedAt, OwnerId)
            VALUES ({clientId}, {"Imobiliária Horizonte"}, {"11222333000181"}, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(),
                    {ownerId});
            INSERT INTO properties (Id, ClientId, Street, Number, Complement, District, City, State, ZipCode, Type,
                                    CreatedAt, UpdatedAt, OwnerId)
            VALUES ({propertyId}, {clientId}, {"Rua das Flores"}, {"120"}, {"ap 32"}, {"Jardim Paulista"},
                    {"São Paulo"}, {"SP"}, {"01400000"}, {"Apartment"}, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(),
                    {ownerId});
            INSERT INTO inspections (Id, PropertyId, Kind, Status, StartedAt, CompletedAt, CreatedAt, UpdatedAt, OwnerId)
            VALUES ({completedId}, {propertyId}, {"MoveIn"}, {"Completed"}, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(),
                    SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(), {ownerId}),
                   ({inProgressId}, {propertyId}, {"MoveIn"}, {"InProgress"}, SYSDATETIMEOFFSET(), NULL,
                    SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(), {ownerId});
            """,
            Ct);

        var before = await Versions(db, ownerId);
        await migrator.MigrateAsync(cancellationToken: Ct);
        var after = await db.Inspections.IgnoreQueryFilters().AsNoTracking()
            .Where(i => i.OwnerId == ownerId)
            .ToDictionaryAsync(i => i.Id, Ct);

        var snapshot = after[completedId].CompletedSnapshot;
        snapshot.Should().BeEquivalentTo(new CompletionSnapshot
        {
            Street = "Rua das Flores",
            Number = "120",
            Complement = "ap 32",
            District = "Jardim Paulista",
            City = "São Paulo",
            State = "SP",
            ZipCode = "01400000",
            PropertyType = PropertyType.Apartment,
            ClientName = "Imobiliária Horizonte",
            ClientDocument = "11222333000181",
        });
        after[completedId].Version.Should().NotEqual(before[completedId], "a concluída volta pelo delta com a cópia");
        after[inProgressId].CompletedSnapshot.Should().BeNull();
        after[inProgressId].Version.Should().Equal(before[inProgressId]);
    }

    private static async Task<Dictionary<Guid, byte[]>> Versions(AppDbContext db, Guid ownerId) =>
        await db.Database
            .SqlQuery<VersionRow>($"SELECT Id, Version FROM inspections WHERE OwnerId = {ownerId}")
            .ToDictionaryAsync(row => row.Id, row => row.Version, Ct);

    private sealed record VersionRow(Guid Id, byte[] Version);
}
