using System.Text.RegularExpressions;
using AwesomeAssertions;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Unit;

// #194: toda imagem de terceiros fica numa tag exata. Uma tag que muda sozinha (`latest`, `2022-latest`, `node:24`)
// faz dois builds do mesmo commit saírem diferentes e esconde do Dependabot o que mudou. As nossas imagens (`vistoria-api`
// e `vistoria-proxy`, que o compose constrói) e as tags por variável (`${IMAGE_TAG:-local}`, `${{ github.sha }}`) ficam
// de fora.
public partial class ImageTagTests
{
    [Fact]
    public void ThirdPartyImages_UseExactTags()
    {
        var floating = ImageRefs()
            .Where(entry => !entry.image.Contains("${", StringComparison.Ordinal) && !OwnImage().IsMatch(entry.image))
            .Where(entry => !IsExact(entry.image))
            .Select(entry => $"{entry.file}: {entry.image}");

        floating.Should().BeEmpty("a imagem fica numa tag exata, que o Dependabot sobe por PR");
    }

    // Sem isto, um regex quebrado faria o teste acima passar sem ler nada.
    [Fact]
    public void ImageRefs_ReadEveryImageSource()
    {
        var files = ImageRefs().Select(entry => entry.file).Distinct();

        files.Should().Contain([
            "infra/docker-compose.dev.yml",
            "infra/docker-compose.prod.yml",
            "apps/api/Dockerfile",
            "infra/proxy/Dockerfile",
        ]);
    }

    [Theory]
    [InlineData("mcr.microsoft.com/mssql/server:2022-CU28-ubuntu-22.04", true)]
    [InlineData("mcr.microsoft.com/dotnet/sdk:10.0.403-noble", true)]
    [InlineData("node:24.22.0-slim", true)]
    [InlineData("caddy:2.11.6-alpine", true)]
    [InlineData("caddy:2.11.6-alpine@sha256:0123456789abcdef", true)]
    [InlineData("mcr.microsoft.com/mssql/server:2022-latest", false)]
    [InlineData("caddy:latest", false)]
    [InlineData("caddy", false)]
    [InlineData("localhost:5000/caddy", false)]
    [InlineData("node:24", false)]
    [InlineData("node:24-slim", false)]
    [InlineData("mcr.microsoft.com/dotnet/aspnet:10.0-noble", false)]
    public void IsExact_TellsExactFromFloatingTags(string image, bool exact) =>
        IsExact(image).Should().Be(exact);

    private static bool IsExact(string image)
    {
        var name = image.Split('@')[0];
        var slash = name.LastIndexOf('/');
        var colon = name.LastIndexOf(':');
        if (colon <= slash)
        {
            return false;
        }

        var tag = name[(colon + 1)..];
        return !tag.Contains("latest", StringComparison.OrdinalIgnoreCase) && !MajorOrMinorOnly().IsMatch(tag);
    }

    private static IEnumerable<(string file, string image)> ImageRefs()
    {
        var composes = Directory.GetFiles(Path.Combine(RepoRoot.Path, "infra"), "docker-compose*.yml")
            .SelectMany(file => Matches(file, ComposeImage()));
        var dockerfiles = new[] { Path.Combine("apps", "api", "Dockerfile"), Path.Combine("infra", "proxy", "Dockerfile") }
            .Select(file => Path.Combine(RepoRoot.Path, file))
            .SelectMany(file => Matches(file, DockerfileFrom()));
        var workflows = Directory.GetFiles(Path.Combine(RepoRoot.Path, ".github", "workflows"), "*.yml")
            .SelectMany(file => Matches(file, WorkflowImage()));

        return composes.Concat(dockerfiles).Concat(workflows);
    }

    private static IEnumerable<(string file, string image)> Matches(string file, Regex pattern)
    {
        var relative = Path.GetRelativePath(RepoRoot.Path, file).Replace('\\', '/');
        return File.ReadLines(file)
            .Where(line => !line.TrimStart().StartsWith('#'))
            .Select(line => pattern.Match(line))
            .Where(match => match.Success)
            .Select(match => (relative, match.Groups["image"].Value.Trim('"', '\'')));
    }

    [GeneratedRegex(@"(^|/)vistoria-[a-z]+(:|$)")]
    private static partial Regex OwnImage();

    // Só a major ou major.minor, com ou sem variante (`24`, `24-slim`, `10.0-noble`): a tag anda a cada patch.
    [GeneratedRegex(@"^v?\d+(\.\d+)?(-[a-z]+)?$", RegexOptions.IgnoreCase)]
    private static partial Regex MajorOrMinorOnly();

    [GeneratedRegex(@"^\s*image:\s*(?<image>\S+)")]
    private static partial Regex ComposeImage();

    [GeneratedRegex(@"^FROM\s+(?:--platform=\S+\s+)?(?<image>\S+)", RegexOptions.IgnoreCase)]
    private static partial Regex DockerfileFrom();

    // `image:` de container e de service, e qualquer imagem do MCR escrita num passo (`docker run`).
    [GeneratedRegex(@"(?:^\s*(?:image|image-ref):\s*|\s)(?<image>(?:mcr\.microsoft\.com|ghcr\.io|docker\.io)/\S+)|^\s*image:\s*(?<image>\S+)")]
    private static partial Regex WorkflowImage();
}
