using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Tests.Unit;

// Sem banco: ambiente e item são AggregateChild (ADR 0035), sem versão nem dono, com o mesmo soft delete da raiz.
public class InspectionModelTests
{
    private static IModel Model()
    {
        using var db = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>().UseSqlServer().Options, TimeProvider.System);
        return db.Model;
    }

    public static TheoryData<Type> Children => new() { typeof(Room), typeof(InspectionItem) };

    [Theory]
    [MemberData(nameof(Children))]
    public void Children_HaveNoVersionNorOwner_AndAreNotSyncEntities(Type type)
    {
        var entity = Model().FindEntityType(type)!;

        type.IsAssignableTo(typeof(AggregateChild)).Should().BeTrue();
        type.IsAssignableTo(typeof(SyncEntity)).Should().BeFalse();
        entity.GetProperties().Should().NotContain(p => p.IsConcurrencyToken);
        entity.FindProperty(nameof(SyncEntity.OwnerId)).Should().BeNull();
    }

    [Theory]
    [MemberData(nameof(Children))]
    public void Children_HaveTheClientKeyAndTheSoftDeleteFilter(Type type)
    {
        var entity = Model().FindEntityType(type)!;

        entity.FindPrimaryKey()!.Properties.Select(p => p.Name).Should().Equal(nameof(AggregateChild.Id));
        entity.FindProperty(nameof(AggregateChild.Id))!.ValueGenerated.Should().Be(ValueGenerated.Never);
        entity.GetDeclaredQueryFilters().Select(f => f.Key).Should().Equal(AppDbContext.SoftDeleteFilter);
    }

    [Fact]
    public void Inspection_IsTheVersionedRoot()
    {
        var inspection = Model().FindEntityType(typeof(Inspection))!;

        typeof(Inspection).IsAssignableTo(typeof(SyncEntity)).Should().BeTrue();
        inspection.FindProperty(nameof(SyncEntity.Version))!.IsConcurrencyToken.Should().BeTrue();
        inspection.GetTableName().Should().Be("inspections");
    }
}
