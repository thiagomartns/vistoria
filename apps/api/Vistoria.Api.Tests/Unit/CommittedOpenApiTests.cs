using System.Text.Json;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Unit;

// O openapi.json commitado é o que o front gera; o CI já garante que ele é igual ao do build.
public class CommittedOpenApiTests
{
    [Fact]
    public void ProblemType_EnumIsExactlyTheCatalog()
    {
        var schema = Document()
            .GetProperty("components").GetProperty("schemas").GetProperty("ProblemType");

        schema.GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo(ProblemTypes.All);
    }

    // backend.md, "Contrato da API": enums como string. O front recebe a union, não números.
    [Fact]
    public void PropertyType_IsAStringEnum_ReferencedByBothDtos()
    {
        var schemas = Document().GetProperty("components").GetProperty("schemas");

        schemas.GetProperty("PropertyType").GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().Equal("apartment", "house", "commercial", "other");
        schemas.GetProperty("PropertyDto").GetProperty("properties").GetProperty("type").GetProperty("$ref")
            .GetString().Should().Be("#/components/schemas/PropertyType");
        schemas.GetProperty("UpsertPropertyDto").GetProperty("properties").GetProperty("type").GetProperty("oneOf")
            .EnumerateArray().Select(s => s.TryGetProperty("$ref", out var r) ? r.GetString() : null)
            .Should().Contain("#/components/schemas/PropertyType");
    }

    // Status da tabela de Endpoints do backend.md.
    [Theory]
    [InlineData("/api/v1/auth/signup", "signUp", "201", new[] { "400", "429" })]
    [InlineData("/api/v1/auth/signin", "signIn", "200", new[] { "400", "401", "429" })]
    public void AuthOperations_ReturnAuthDto_AndTheirProblems(string path, string operationId, string success,
        string[] problems)
    {
        var operation = Document().GetProperty("paths").GetProperty(path).GetProperty("post");
        var responses = operation.GetProperty("responses");

        operation.GetProperty("operationId").GetString().Should().Be(operationId);
        responses.EnumerateObject().Select(r => r.Name).Should().BeEquivalentTo([success, .. problems]);
        responses.GetProperty(success).GetProperty("content").GetProperty("application/json").GetProperty("schema")
            .GetProperty("$ref").GetString().Should().Be("#/components/schemas/AuthDto");
        foreach (var status in problems)
        {
            responses.GetProperty(status).GetProperty("content").GetProperty("application/problem+json")
                .GetProperty("schema").GetProperty("$ref").GetString()
                .Should().Be("#/components/schemas/ProblemDetails");
        }

        responses.GetProperty("429").GetProperty("headers").TryGetProperty("Retry-After", out _).Should().BeTrue();
    }

    private static JsonElement Document() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot.Path, "apps", "api", "openapi.json"))).RootElement;
}
