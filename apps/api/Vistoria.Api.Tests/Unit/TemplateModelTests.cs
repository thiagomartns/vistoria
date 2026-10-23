using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Tests.Unit;

// Sem banco: o roteiro é um molde, nunca consultado por item (backend.md, "Entidade sincronizável"), então ambientes
// e itens são tipos complexos numa coluna JSON da tabela templates, sem tabela nem chave própria.
public class TemplateModelTests
{
    private static IModel Model()
    {
        using var db = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>().UseSqlServer().Options, TimeProvider.System);
        return db.Model;
    }

    [Fact]
    public void Rooms_AreAComplexCollectionInOneJsonColumnOfTemplates()
    {
        var template = Model().FindEntityType(typeof(Template))!;
        var rooms = template.FindComplexProperty(nameof(Template.Rooms))!;

        template.GetTableName().Should().Be("templates");
        rooms.IsCollection.Should().BeTrue();
        rooms.ComplexType.IsMappedToJson().Should().BeTrue();
        rooms.ComplexType.GetContainerColumnName().Should().Be(nameof(Template.Rooms));
    }

    [Fact]
    public void Items_AreNestedInTheSameJsonColumn()
    {
        var rooms = Model().FindEntityType(typeof(Template))!.FindComplexProperty(nameof(Template.Rooms))!;
        var items = rooms.ComplexType.FindComplexProperty(nameof(TemplateRoom.Items))!;

        items.IsCollection.Should().BeTrue();
        items.ComplexType.IsMappedToJson().Should().BeTrue();
        items.ComplexType.GetContainerColumnName().Should().Be(nameof(Template.Rooms));
    }

    [Fact]
    public void RoomsAndItems_AreNotEntities()
    {
        var model = Model();

        model.FindEntityType(typeof(TemplateRoom)).Should().BeNull();
        model.FindEntityType(typeof(TemplateItem)).Should().BeNull();
    }
}
