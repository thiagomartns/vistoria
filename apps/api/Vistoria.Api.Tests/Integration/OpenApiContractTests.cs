using System.Text.Json;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class OpenApiContractTests(TestControllersFactory factory) : IClassFixture<TestControllersFactory>
{
    private const string WidgetPath = "/test/contract/widgets/{id}";
    private const string ProblemDetailsRef = "#/components/schemas/ProblemDetails";

    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task ProblemType_EnumIsExactlyTheCatalog()
    {
        var schema = (await GetDocument()).GetProperty("components").GetProperty("schemas").GetProperty("ProblemType");

        schema.GetProperty("type").GetString().Should().Be("string");
        schema.GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo(ProblemTypes.All);
    }

    [Fact]
    public async Task ProblemDetails_TypeReferencesProblemType_AndDeclaresExtensions()
    {
        var schema = (await GetDocument()).GetProperty("components").GetProperty("schemas").GetProperty("ProblemDetails");
        var properties = schema.GetProperty("properties");

        properties.GetProperty("type").GetProperty("$ref").GetString().Should().Be("#/components/schemas/ProblemType");
        schema.GetProperty("required").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo("type", "title", "status", "detail", "traceId");
        properties.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            "type", "title", "status", "detail", "traceId", "errors", "current", "deletedAt", "missingHeader");
    }

    [Theory]
    [InlineData("put")]
    [InlineData("delete")]
    public async Task Writes_DocumentIfMatchAsOptionalAndIdempotencyKeyAsRequired(string method)
    {
        var headers = HeaderParameters(await GetOperation(method));

        headers.Should().ContainKey("If-Match").WhoseValue.Should().BeFalse();
        headers.Should().ContainKey("Idempotency-Key").WhoseValue.Should().BeTrue();
    }

    [Fact]
    public async Task Get_HasNoWriteHeaders()
    {
        HeaderParameters(await GetOperation("get")).Should().BeEmpty();
    }

    [Theory]
    [InlineData("get", new[] { 401, 404 })]
    [InlineData("put", new[] { 400, 401, 403, 409, 410, 412, 422, 428, 429 })]
    [InlineData("delete", new[] { 401, 403, 409, 412, 422, 428, 429 })]
    public async Task ErrorResponses_AreTheDeclaredOnes_AsProblemJson(string method, int[] statuses)
    {
        var responses = (await GetOperation(method)).GetProperty("responses");
        var errors = responses.EnumerateObject().Where(r => r.Name[0] is '4' or '5').ToList();

        errors.Select(r => int.Parse(r.Name, System.Globalization.CultureInfo.InvariantCulture))
            .Should().BeEquivalentTo(statuses);
        errors.Should().AllSatisfy(r =>
        {
            var content = r.Value.GetProperty("content");
            content.EnumerateObject().Select(c => c.Name).Should().Equal("application/problem+json");
            content.GetProperty("application/problem+json").GetProperty("schema").GetProperty("$ref").GetString()
                .Should().Be(ProblemDetailsRef);
        });
    }

    [Fact]
    public async Task RetryAfter_IsDocumentedOnlyOn429And409()
    {
        var responses = (await GetOperation("put")).GetProperty("responses");

        var withRetryAfter = responses.EnumerateObject()
            .Where(r => r.Value.TryGetProperty("headers", out var h) && h.TryGetProperty("Retry-After", out _))
            .Select(r => r.Name);

        withRetryAfter.Should().BeEquivalentTo("409", "429");
        responses.GetProperty("429").GetProperty("headers").GetProperty("Retry-After").GetProperty("schema")
            .GetProperty("type").GetString().Should().Be("integer");
    }

    private static Dictionary<string, bool> HeaderParameters(JsonElement operation) =>
        operation.TryGetProperty("parameters", out var parameters)
            ? parameters.EnumerateArray()
                .Where(p => p.GetProperty("in").GetString() == "header")
                .ToDictionary(
                    p => p.GetProperty("name").GetString()!,
                    p => p.TryGetProperty("required", out var r) && r.GetBoolean())
            : [];

    private async Task<JsonElement> GetOperation(string method) =>
        (await GetDocument()).GetProperty("paths").GetProperty(WidgetPath).GetProperty(method);

    private async Task<JsonElement> GetDocument()
    {
        var raw = await _client.GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken);
        return JsonDocument.Parse(raw).RootElement;
    }
}
