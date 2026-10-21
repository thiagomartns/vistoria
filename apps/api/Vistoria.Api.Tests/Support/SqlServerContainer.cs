using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Testcontainers.MsSql;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// SQL Server do Testcontainers, um por execução e compartilhado por todas as factories. Sobe na primeira factory
/// que pedir (teste unitário não precisa de Docker); o Ryuk do Testcontainers o remove quando o processo termina.
/// </summary>
public static partial class SqlServerContainer
{
    /// <summary>Banco dos testes de integração; cada teste cria os próprios dados com IDs novos.</summary>
    public const string SharedDatabase = "vistoria";

    private static readonly Lazy<Task<MsSqlContainer>> Container = new(StartAsync);

    public static async Task<string> ConnectionStringAsync(string database = SharedDatabase)
    {
        var container = await Container.Value;
        return WithDatabase(container, database);
    }

    private static async Task<MsSqlContainer> StartAsync()
    {
        var container = new MsSqlBuilder(DevComposeImage()).Build();
        await container.StartAsync();

        // Cria e migra o banco compartilhado uma vez, antes de qualquer host: factories subindo em paralelo
        // não disputam o CREATE DATABASE. O startup de cada uma só confere que não há migração pendente.
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer(WithDatabase(container, SharedDatabase))
            .Options;
        await using var db = new AppDbContext(options, TimeProvider.System);
        await db.Database.MigrateAsync();

        return container;
    }

    private static string WithDatabase(MsSqlContainer container, string database) =>
        new SqlConnectionStringBuilder(container.GetConnectionString()) { InitialCatalog = database }.ConnectionString;

    // A mesma imagem do SQL Server local (pnpm db:up), lida do compose para as duas nunca divergirem.
    private static string DevComposeImage()
    {
        var compose = File.ReadAllText(Path.Combine(RepoRoot.Path, "infra", "docker-compose.dev.yml"));
        var match = ImagePattern().Match(compose);
        return match.Success
            ? match.Groups["image"].Value
            : throw new InvalidOperationException("Imagem do SQL Server não encontrada em infra/docker-compose.dev.yml.");
    }

    [GeneratedRegex(@"image:\s*(?<image>mcr\.microsoft\.com/mssql/server:\S+)")]
    private static partial Regex ImagePattern();
}
