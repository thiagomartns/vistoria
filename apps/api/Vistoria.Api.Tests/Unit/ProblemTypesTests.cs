using System.Text.RegularExpressions;
using AwesomeAssertions;
using Microsoft.AspNetCore.Http;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Unit;

public partial class ProblemTypesTests
{
    // Uma instância de cada exceção do catálogo; a reflexão abaixo garante que nenhuma fica de fora.
    public static readonly AppException[] Samples =
    [
        new ValidationException(new Dictionary<string, string[]> { ["name"] = ["Obrigatório."] }),
        new InvalidCursorException(),
        new UnauthorizedException(),
        new InvalidCredentialsException(),
        new ForbiddenException(),
        new NotFoundException(),
        new UnsupportedRequestException(StatusCodes.Status405MethodNotAllowed),
        VersionConflictException.OnSave(new { version = "AAA=" }),
        VersionConflictException.OnIfMatch(new { version = "AAA=" }),
        new IdempotencyInProgressException(TimeSpan.FromSeconds(2)),
        new LockedException(new { version = "AAA=" }),
        new DeletedException(DateTimeOffset.UnixEpoch),
        new CursorExpiredException(),
        new IdempotencyKeyReusedException(),
        new PreconditionRequiredException("If-Match"),
        new RateLimitedException(TimeSpan.FromSeconds(10)),
        new InternalException(),
    ];

    [Fact]
    public void Catalog_MatchesBackendDoc()
    {
        ProblemTypes.All.Select(t => t[ProblemTypes.Prefix.Length..]).Should().BeEquivalentTo(ReadDocCatalog());
    }

    [Fact]
    public void EveryType_IsAnUrnWithASlug()
    {
        ProblemTypes.All.Should().AllSatisfy(t => t.Should().MatchRegex("^urn:vistoria:problem:[a-z]+(-[a-z]+)*$"));
    }

    [Fact]
    public void EveryType_HasAnException()
    {
        Samples.Select(e => e.Type).Distinct().Should().BeEquivalentTo(ProblemTypes.All);
    }

    [Fact]
    public void EveryExceptionClass_IsCoveredBySamples()
    {
        var classes = typeof(AppException).Assembly.GetTypes()
            .Where(t => t.IsSubclassOf(typeof(AppException)) && !t.IsAbstract);

        Samples.Select(e => e.GetType()).Distinct().Should().BeEquivalentTo(classes);
    }

    [Fact]
    public void EveryType_HasTitleAndDetail()
    {
        foreach (var type in ProblemTypes.All)
        {
            ProblemTypes.TitleOf(type).Should().NotBeNullOrWhiteSpace();
            ProblemTypes.DetailOf(type).Should().NotBeNullOrWhiteSpace();
        }
    }

    [Fact]
    public void VersionConflict_StatusComesFromWhereItWasDetected()
    {
        var onSave = VersionConflictException.OnSave(new { });
        var onIfMatch = VersionConflictException.OnIfMatch(new { });

        onSave.Type.Should().Be(ProblemTypes.VersionConflict);
        onSave.Status.Should().Be(StatusCodes.Status409Conflict);
        onIfMatch.Type.Should().Be(ProblemTypes.VersionConflict);
        onIfMatch.Status.Should().Be(StatusCodes.Status412PreconditionFailed);
    }

    [Fact]
    public void UnsupportedRequest_RejectsStatusOutsideItsRange()
    {
        var act = () => new UnsupportedRequestException(StatusCodes.Status400BadRequest);

        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Theory]
    [InlineData(400, ProblemTypes.Validation)]
    [InlineData(401, ProblemTypes.Unauthorized)]
    [InlineData(403, ProblemTypes.Forbidden)]
    [InlineData(404, ProblemTypes.NotFound)]
    [InlineData(405, ProblemTypes.UnsupportedRequest)]
    [InlineData(406, ProblemTypes.UnsupportedRequest)]
    [InlineData(415, ProblemTypes.UnsupportedRequest)]
    [InlineData(429, ProblemTypes.RateLimited)]
    [InlineData(418, ProblemTypes.Internal)]
    [InlineData(500, ProblemTypes.Internal)]
    [InlineData(503, ProblemTypes.Internal)]
    public void FromStatus_MapsPipelineResponses(int status, string expected)
    {
        ProblemTypes.FromStatus(status).Should().Be(expected);
    }

    // Slugs da coluna `type` da tabela "Catálogo de erros" em docs/architecture/backend.md.
    private static HashSet<string> ReadDocCatalog()
    {
        var lines = File.ReadAllLines(Path.Combine(RepoRoot.Path, "docs", "architecture", "backend.md"));
        var table = lines
            .SkipWhile(l => l.Trim() != "### Catálogo de erros")
            .Skip(1)
            .SkipWhile(l => !l.StartsWith('|'))
            .TakeWhile(l => l.StartsWith('|'))
            .Skip(2); // cabeçalho e separador

        var slugs = table
            .Select(row => SlugCell().Match(row.Split('|')[2]))
            .Where(m => m.Success)
            .Select(m => m.Groups[1].Value)
            .ToHashSet();

        slugs.Should().NotBeEmpty("a tabela do catálogo precisa existir em backend.md");
        return slugs;
    }

    [GeneratedRegex(@"`([a-z-]+)`")]
    private static partial Regex SlugCell();
}
