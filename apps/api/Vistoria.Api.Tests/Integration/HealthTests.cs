using System.Net;
using System.Net.Http.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Tests.Integration;

public class HealthTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
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
