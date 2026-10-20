using System.Net;
using System.Net.Http.Json;
using AwesomeAssertions;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class HealthTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetHealth_ReturnsOk()
    {
        var response = await _client.GetAsync("/api/v1/health", TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<HealthDto>(TestContext.Current.CancellationToken);
        body!.Status.Should().Be("ok");
    }

    [Fact]
    public async Task OpenApiDocument_ContainsGetHealthOperation()
    {
        var document = await _client.GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken);

        document.Should().Contain("\"operationId\": \"getHealth\"");
    }
}
