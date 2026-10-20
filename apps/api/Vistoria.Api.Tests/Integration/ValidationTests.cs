using System.Net;
using System.Text;
using System.Text.Json;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class ValidationTests(TestControllersFactory factory) : IClassFixture<TestControllersFactory>
{
    private const string ValidBody = """{"title":"Vistoria","items":[{"name":"ok","quantity":1}]}""";

    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task InvalidNestedField_KeyIsJsonPath()
    {
        var errors = await PostExpectingValidation(
            """{"title":"Vistoria","items":[{"name":"ok","quantity":1},{"name":"longo","quantity":2}]}""");

        errors.Keys.Should().Equal("items[1].name");
    }

    [Fact]
    public async Task MissingRequired_TopLevelKeyIsCamelCase()
    {
        var errors = await PostExpectingValidation("""{"items":[{"name":"ok","quantity":1}]}""");

        errors.Keys.Should().Equal("title");
    }

    [Fact]
    public async Task WrongTypeNested_KeyWithoutDollarPrefix()
    {
        var (raw, errors) = await PostExpectingValidationRaw(
            """{"title":"Vistoria","items":[{"name":"ok","quantity":"dois"}]}""");

        errors.Keys.Should().Equal("items[0].quantity");
        errors["items[0].quantity"].Should().Equal(ModelStateErrors.InvalidValueMessage);
        raw.Should().NotContain("Vistoria.").And.NotContain("System.").And.NotContain("LineNumber");
    }

    [Theory]
    [InlineData("""{"title":""", "title")]
    [InlineData("[1]", "")]
    [InlineData("", "")]
    [InlineData("null", "")]
    public async Task MalformedJson_Returns400Validation(string body, string expectedKey)
    {
        var errors = await PostExpectingValidation(body);

        errors.Keys.Should().Equal(expectedKey);
        errors.Keys.Should().NotContain(k => k.StartsWith('$') || k == "body");
    }

    [Fact]
    public async Task ServiceValidationException_SameShapeAsModelState()
    {
        var fromModelState = await Post("/test/validation", """{"items":[]}""");
        var fromService = await Post("/test/validation/service", ValidBody);

        fromService.Response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        fromService.Response.Content.Headers.ContentType!.MediaType
            .Should().Be(fromModelState.Response.Content.Headers.ContentType!.MediaType);
        Members(fromService.Body).Should().Equal(Members(fromModelState.Body));
        fromService.Body.GetProperty("type").GetString().Should().Be(ProblemTypes.Validation);
        Errors(fromService.Body).Should().ContainKey(ValidationController.ServicePath)
            .WhoseValue.Should().Equal("Obrigatório.");
    }

    private async Task<Dictionary<string, string[]>> PostExpectingValidation(string body) =>
        (await PostExpectingValidationRaw(body)).Errors;

    private async Task<(string Raw, Dictionary<string, string[]> Errors)> PostExpectingValidationRaw(string body)
    {
        var (response, json, raw) = await Post("/test/validation", body);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        json.GetProperty("type").GetString().Should().Be(ProblemTypes.Validation);
        return (raw, Errors(json));
    }

    private async Task<(HttpResponseMessage Response, JsonElement Body, string Raw)> Post(string path, string body)
    {
        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        var response = await _client.PostAsync(path, content, TestContext.Current.CancellationToken);
        var raw = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        return (response, JsonDocument.Parse(raw).RootElement, raw);
    }

    private static string[] Members(JsonElement body) => [.. body.EnumerateObject().Select(p => p.Name).Order()];

    private static Dictionary<string, string[]> Errors(JsonElement body) =>
        body.GetProperty("errors").EnumerateObject().ToDictionary(
            p => p.Name,
            p => p.Value.EnumerateArray().Select(m => m.GetString()!).ToArray());
}
