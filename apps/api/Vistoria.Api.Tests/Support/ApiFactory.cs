using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Vistoria.Api.Configurations;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// API em Development apontando para o SQL Server do <see cref="SqlServerContainer"/>. O startup roda o
/// <c>MigrateAsync</c> de verdade, como no <c>pnpm dev:api</c>.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private string? _connectionString;

    protected virtual string Database => SqlServerContainer.SharedDatabase;

    public async ValueTask InitializeAsync() =>
        _connectionString = await SqlServerContainer.ConnectionStringAsync(Database);

    // Por último na configuração, para vencer um User Secret de dev que exista na máquina.
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                [$"ConnectionStrings:{DatabaseConfig.ConnectionStringName}"] = _connectionString,
            }));
}
