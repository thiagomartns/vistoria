using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Repositories;
using Vistoria.Api.Repositories.Impl;
using Vistoria.Api.Sync;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Base comum de toda SyncEntity, pela entidade só de teste, no SQL Server real.
public class SyncEntityTests(SyncDatabase database) : IClassFixture<SyncDatabase>
{
    private static readonly DateTimeOffset ClientDate = new(2001, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Add_StampsCreatedAndUpdatedAtFromTimeProvider_IgnoringClientValues()
    {
        var now = database.Time.GetUtcNow();
        var probe = NewProbe();
        probe.CreatedAt = ClientDate;
        probe.UpdatedAt = ClientDate;

        await using (var db = database.CreateContext())
        {
            await new GenericRepository<SyncProbe>(db).AddAsync(probe, Ct);
        }

        var stored = await Read(probe.Id);
        stored.CreatedAt.Should().Be(now);
        stored.UpdatedAt.Should().Be(now);
    }

    [Fact]
    public async Task Update_ChangesUpdatedAtButNotCreatedAt()
    {
        var created = await Add(NewProbe());
        var createdAt = created.CreatedAt;
        database.Time.Advance(TimeSpan.FromMinutes(5));
        var now = database.Time.GetUtcNow();

        await Update(Changed(created, createdAt: ClientDate, updatedAt: ClientDate));

        var stored = await Read(created.Id);
        stored.CreatedAt.Should().Be(createdAt);
        stored.UpdatedAt.Should().Be(now).And.NotBe(createdAt);
        stored.Name.Should().Be("alterado");
    }

    [Fact]
    public async Task Version_ChangesOnEverySaveThatChangesTheRecord()
    {
        var created = await Add(NewProbe());
        var v1 = created.Version;
        v1.Should().HaveCount(ETagHelper.VersionLength);

        var v2 = (await Update(Changed(created)))!.Version;
        v2.Should().NotEqual(v1);

        var v3 = (await Update(Changed(await Read(created.Id), name: "de novo")))!.Version;
        v3.Should().NotEqual(v2);

        await using (var db = database.CreateContext())
        {
            (await new GenericRepository<SyncProbe>(db).DeleteAsync(created.Id, v3, Ct)).Should().BeTrue();
        }

        var v4 = (await ReadIncludingDeleted(created.Id)).Version;
        v4.Should().NotEqual(v3);
    }

    // Todo PUT aceito sobe a versão, mesmo sem mudar nada (ADR 0028).
    [Fact]
    public async Task Update_WithTheSameValues_StillChangesTheVersion()
    {
        var created = await Add(NewProbe());

        var updated = (await Update(Changed(created, name: created.Name)))!;

        updated.Version.Should().NotEqual(created.Version);
        (await Read(created.Id)).Version.Should().Equal(updated.Version);
    }

    [Fact]
    public async Task Update_WithStaleVersion_ThrowsConcurrencyExceptionAndKeepsRecord()
    {
        var created = await Add(NewProbe());
        await Update(Changed(created, name: "primeiro"));

        // Mesma versão-base do primeiro update: o "update cego" sobrescreveria; aqui o EF recusa.
        var stale = () => Update(Changed(created, name: "segundo"));

        await stale.Should().ThrowAsync<DbUpdateConcurrencyException>();
        (await Read(created.Id)).Name.Should().Be("primeiro");
    }

    [Fact]
    public async Task Delete_WithStaleVersion_ThrowsConcurrencyExceptionAndKeepsRecord()
    {
        var created = await Add(NewProbe());
        await Update(Changed(created, name: "primeiro"));

        await using var db = database.CreateContext();
        var stale = () => new GenericRepository<SyncProbe>(db).DeleteAsync(created.Id, created.Version, Ct);

        await stale.Should().ThrowAsync<DbUpdateConcurrencyException>();
        (await Read(created.Id)).Name.Should().Be("primeiro");
    }

    [Fact]
    public async Task Delete_IsSoft_HiddenFromQueriesButVisibleIgnoringFilters()
    {
        var created = await Add(NewProbe());
        database.Time.Advance(TimeSpan.FromMinutes(1));
        var now = database.Time.GetUtcNow();

        await using (var db = database.CreateContext())
        {
            var repository = new GenericRepository<SyncProbe>(db);
            (await repository.FindTombstoneAsync(created.Id, Ct)).Should().BeNull();
            (await repository.DeleteAsync(created.Id, created.Version, Ct)).Should().BeTrue();
        }

        await using (var db = database.CreateContext())
        {
            var repository = new GenericRepository<SyncProbe>(db);
            (await repository.FindByIdAsync(created.Id, Ct)).Should().BeNull();
            (await db.Probes.AnyAsync(p => p.Id == created.Id, Ct)).Should().BeFalse();
            (await repository.FindTombstoneAsync(created.Id, Ct)).Should().Be(new Tombstone(created.OwnerId, now));
            (await repository.DeleteAsync(created.Id, created.Version, Ct)).Should().BeFalse();
            (await repository.UpdateAsync(Changed(created), Ct)).Should().BeNull();
        }

        var tombstone = await ReadIncludingDeleted(created.Id);
        tombstone.DeletedAt.Should().Be(now);
        tombstone.UpdatedAt.Should().Be(now);
        tombstone.CreatedAt.Should().Be(created.CreatedAt);
    }

    [Fact]
    public async Task RecordWithDeletedAt_IsHiddenByTheNamedSoftDeleteFilter()
    {
        var probe = NewProbe();
        probe.DeletedAt = ClientDate;
        await Add(probe);

        await using var db = database.CreateContext();
        (await db.Probes.AnyAsync(p => p.Id == probe.Id, Ct)).Should().BeFalse();
        (await db.Probes.IgnoreQueryFilters([AppDbContext.SoftDeleteFilter]).AnyAsync(p => p.Id == probe.Id, Ct))
            .Should().BeTrue();
    }

    private static SyncProbe NewProbe() =>
        new() { Id = Guid.CreateVersion7(), OwnerId = Guid.CreateVersion7(), Name = "original" };

    // Como o cliente manda: um objeto novo com a versão que ele leu, nunca a instância rastreada.
    private static SyncProbe Changed(SyncProbe read, string name = "alterado", DateTimeOffset? createdAt = null,
        DateTimeOffset? updatedAt = null) => new()
    {
        Id = read.Id,
        OwnerId = read.OwnerId,
        Version = read.Version,
        Name = name,
        CreatedAt = createdAt ?? read.CreatedAt,
        UpdatedAt = updatedAt ?? read.UpdatedAt,
    };

    private async Task<SyncProbe> Add(SyncProbe probe)
    {
        await using var db = database.CreateContext();
        return await new GenericRepository<SyncProbe>(db).AddAsync(probe, Ct);
    }

    private async Task<SyncProbe?> Update(SyncProbe probe)
    {
        await using var db = database.CreateContext();
        return await new GenericRepository<SyncProbe>(db).UpdateAsync(probe, Ct);
    }

    private async Task<SyncProbe> Read(Guid id)
    {
        await using var db = database.CreateContext();
        return await db.Probes.AsNoTracking().SingleAsync(p => p.Id == id, Ct);
    }

    private async Task<SyncProbe> ReadIncludingDeleted(Guid id)
    {
        await using var db = database.CreateContext();
        return await db.Probes.AsNoTracking().IgnoreQueryFilters().SingleAsync(p => p.Id == id, Ct);
    }
}
