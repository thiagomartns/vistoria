using System.Net;
using AwesomeAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Vistoria.Api.Configurations;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class HealthTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory]
    [InlineData(HealthConfig.LivePath)]
    [InlineData(HealthConfig.ReadyPath)]
    public async Task WithTheDatabaseUp_Returns200WithoutToken(string path)
    {
        var response = await factory.CreateClient().GetAsync(path, TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).Should().Be("Healthy");
    }

    // O 503 é a resposta do próprio health check: o ProblemDetails do catálogo não a reescreve.
    [Fact]
    public async Task WithoutTheDatabase_ReadyReturns503AndLiveStays200()
    {
        await using var unreachable = new UnreachableDatabaseFactory();
        await unreachable.InitializeAsync();
        var client = unreachable.CreateClient();

        var ready = await client.GetAsync(HealthConfig.ReadyPath, TestContext.Current.CancellationToken);
        var live = await client.GetAsync(HealthConfig.LivePath, TestContext.Current.CancellationToken);

        ready.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        ready.Content.Headers.ContentType!.MediaType.Should().Be("text/plain");
        (await ready.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).Should().Be("Unhealthy");
        live.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task OpenApiDocument_HasNoHealthEndpoints()
    {
        var document = await factory.CreateClient()
            .GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken);

        document.Should().Contain("\"operationId\": \"signIn\"").And.NotContain("/health");
    }

    /// <summary>
    /// Banco numa porta fechada, com timeout de 1 s. Em Production, o startup não roda o <c>MigrateAsync</c>,
    /// que falharia sem banco.
    /// </summary>
    private sealed class UnreachableDatabaseFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseEnvironment("Production");
            builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    [$"ConnectionStrings:{DatabaseConfig.ConnectionStringName}"] =
                        "Server=127.0.0.1,1;Database=vistoria;Connect Timeout=1;TrustServerCertificate=True",
                }));
        }
    }
}
