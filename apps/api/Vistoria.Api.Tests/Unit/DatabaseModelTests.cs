using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Tests.Unit;

// Sem banco: compara o modelo do AppDbContext com o snapshot das migrações.
public class DatabaseModelTests
{
    [Fact]
    public void Model_HasNoChangesMissingAMigration()
    {
        using var db = CreateContext();

        db.Database.HasPendingModelChanges().Should().BeFalse(
            "toda mudança no modelo vem com migração: dotnet ef migrations add <Nome> --project Vistoria.Api");
    }

    [Fact]
    public void Migrations_StartWithBaseline()
    {
        using var db = CreateContext();

        db.Database.GetMigrations().Should().NotBeEmpty()
            .And.Subject.First().Should().EndWith("_Baseline");
    }

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer().Options, TimeProvider.System);
}
