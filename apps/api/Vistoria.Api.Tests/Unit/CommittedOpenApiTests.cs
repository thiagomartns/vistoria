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

    [Fact]
    public void SignUp_Returns201AuthDto_And400Problem()
    {
        var operation = Document().GetProperty("paths").GetProperty("/api/v1/auth/signup").GetProperty("post");
        var responses = operation.GetProperty("responses");

        operation.GetProperty("operationId").GetString().Should().Be("signUp");
        responses.EnumerateObject().Select(r => r.Name).Should().BeEquivalentTo("201", "400");
        responses.GetProperty("201").GetProperty("content").GetProperty("application/json").GetProperty("schema")
            .GetProperty("$ref").GetString().Should().Be("#/components/schemas/AuthDto");
        responses.GetProperty("400").GetProperty("content").GetProperty("application/problem+json")
            .GetProperty("schema").GetProperty("$ref").GetString().Should().Be("#/components/schemas/ProblemDetails");
    }

    private static JsonElement Document() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot.Path, "apps", "api", "openapi.json"))).RootElement;
}
