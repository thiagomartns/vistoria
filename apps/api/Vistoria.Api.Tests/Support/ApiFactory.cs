using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Vistoria.Api.Configurations;
using Vistoria.Api.Infrastructure.Auth;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// API em Development apontando para o SQL Server do <see cref="SqlServerContainer"/>. O startup roda o
/// <c>MigrateAsync</c> de verdade, como no <c>pnpm dev:api</c>. Cada factory tem a própria chave do JWT e um
/// relógio manual no lugar do <see cref="TimeProvider"/> do sistema.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private string? _connectionString;

    /// <summary>Instante inicial do <see cref="Time"/>, em segundos inteiros como no JWT.</summary>
    public static readonly DateTimeOffset Start = new(2026, 10, 20, 12, 0, 0, TimeSpan.Zero);

    public ManualTimeProvider Time { get; } = new(Start);

    public string JwtSigningKey { get; } = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

    protected virtual string Database => SqlServerContainer.SharedDatabase;

    public async ValueTask InitializeAsync() =>
        _connectionString = await SqlServerContainer.ConnectionStringAsync(Database);

    // Por último na configuração, para vencer um User Secret de dev que exista na máquina.
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                [$"ConnectionStrings:{DatabaseConfig.ConnectionStringName}"] = _connectionString,
                [$"{JwtOptions.Section}:{nameof(JwtOptions.SigningKey)}"] = JwtSigningKey,
            }));
        builder.ConfigureTestServices(services => services.Replace(ServiceDescriptor.Singleton<TimeProvider>(Time)));
    }
}
