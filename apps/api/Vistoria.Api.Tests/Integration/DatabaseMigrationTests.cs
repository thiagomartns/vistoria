using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class DatabaseMigrationTests(DatabaseMigrationTests.NewDatabaseFactory factory)
    : IClassFixture<DatabaseMigrationTests.NewDatabaseFactory>
{
    /// <summary>Banco que ainda não existe no container: só o startup da API pode criá-lo e migrá-lo.</summary>
    public class NewDatabaseFactory : ApiFactory
    {
        public string Name { get; } = $"vistoria_{Guid.NewGuid():N}";

        protected override string Database => Name;
    }

    [Fact]
    public async Task Startup_AppliesAllMigrationsToNewDatabase()
    {
        // Services sobe o host, e com ele o MigrateAsync do startup.
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        db.Database.GetDbConnection().Database.Should().Be(factory.Name);
        var applied = await db.Database.GetAppliedMigrationsAsync(TestContext.Current.CancellationToken);
        applied.Should().Equal(db.Database.GetMigrations())
            .And.ContainSingle(migration => migration.EndsWith("_Baseline", StringComparison.Ordinal));
        (await db.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken)).Should().BeEmpty();
    }
}
