using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Vistoria.Api.Configurations;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Model;

namespace Vistoria.Api.Tests.Support;

/// <summary>
/// API em Development apontando para o SQL Server do <see cref="SqlServerContainer"/>. O startup roda o
/// <c>MigrateAsync</c> de verdade, como no <c>pnpm dev:api</c>. Cada factory tem a própria chave do JWT e um
/// relógio manual no lugar do <see cref="TimeProvider"/> do sistema. Cada <c>CreateClient()</c> sai com um IP
/// próprio (<see cref="RemoteIpHeader"/>), então cada cliente tem o próprio balde do rate limit.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private string? _connectionString;

    /// <summary>Instante inicial do <see cref="Time"/>, em segundos inteiros como no JWT.</summary>
    public static readonly DateTimeOffset Start = new(2026, 10, 20, 12, 0, 0, TimeSpan.Zero);

    public ManualTimeProvider Time { get; } = new(Start);

    public string JwtSigningKey { get; } = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

    /// <summary>Cabeçalho só de teste: vira o <c>RemoteIpAddress</c> da requisição, que o TestServer deixa vazio.</summary>
    public const string RemoteIpHeader = "X-Test-Remote-Ip";

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
        builder.ConfigureTestServices(services =>
        {
            services.Replace(ServiceDescriptor.Singleton<TimeProvider>(Time));
            services.AddTransient<IStartupFilter, RemoteIpFromHeader>();
        });
    }

    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        client.DefaultRequestHeaders.Add(RemoteIpHeader, new IPAddress(Guid.NewGuid().ToByteArray()).ToString());
    }

    /// <summary>Cliente com um access token emitido agora pelo <see cref="Time"/>, sem passar pelo signup.</summary>
    public HttpClient CreateAuthenticatedClient(Guid? userId = null)
    {
        var token = Services.GetRequiredService<AccessTokenGenerator>()
            .Create(new User { Id = userId ?? Guid.CreateVersion7() });
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
        return client;
    }

    // Antes de todo o pipeline da API, inclusive do rate limiter, que particiona pelo IP.
    private sealed class RemoteIpFromHeader : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, nextMiddleware) =>
            {
                if (IPAddress.TryParse(context.Request.Headers[RemoteIpHeader], out var ip))
                {
                    context.Connection.RemoteIpAddress = ip;
                }

                return nextMiddleware(context);
            });
            next(app);
        };
    }
}
