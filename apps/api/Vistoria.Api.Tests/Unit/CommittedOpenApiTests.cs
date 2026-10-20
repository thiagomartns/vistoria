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
        var raw = File.ReadAllText(Path.Combine(RepoRoot.Path, "apps", "api", "openapi.json"));
        var schema = JsonDocument.Parse(raw).RootElement
            .GetProperty("components").GetProperty("schemas").GetProperty("ProblemType");

        schema.GetProperty("enum").EnumerateArray().Select(e => e.GetString())
            .Should().BeEquivalentTo(ProblemTypes.All);
    }
}
