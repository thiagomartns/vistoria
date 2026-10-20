using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Unit;

// Sem banco: a configuração comum chega a uma SyncEntity sem configuração própria de chave, versão ou filtro.
public class SyncEntityModelTests
{
    private static IEntityType ProbeType()
    {
        using var db = new SyncTestDbContext(
            new DbContextOptionsBuilder<AppDbContext>().UseSqlServer().Options, TimeProvider.System);
        return db.Model.FindEntityType(typeof(SyncProbe))!;
    }

    [Fact]
    public void Id_IsKeyGeneratedByTheClient()
    {
        var entity = ProbeType();

        entity.FindPrimaryKey()!.Properties.Select(p => p.Name).Should().Equal(nameof(SyncEntity.Id));
        entity.FindProperty(nameof(SyncEntity.Id))!.ValueGenerated.Should().Be(ValueGenerated.Never);
    }

    [Fact]
    public void Version_IsRowVersionConcurrencyToken()
    {
        var version = ProbeType().FindProperty(nameof(SyncEntity.Version))!;

        version.IsConcurrencyToken.Should().BeTrue();
        version.ValueGenerated.Should().Be(ValueGenerated.OnAddOrUpdate);
        version.GetColumnType().Should().Be("rowversion");
    }

    [Fact]
    public void SoftDelete_IsNamedQueryFilter()
    {
        ProbeType().GetDeclaredQueryFilters().Select(f => f.Key).Should().Equal(AppDbContext.SoftDeleteFilter);
    }

    [Fact]
    public void OwnerIdAndVersion_AreIndexedForTheDelta()
    {
        string[] columns = [nameof(SyncEntity.OwnerId), nameof(SyncEntity.Version)];

        ProbeType().GetIndexes().Should().Contain(i => i.Properties.Select(p => p.Name).SequenceEqual(columns));
    }
}
