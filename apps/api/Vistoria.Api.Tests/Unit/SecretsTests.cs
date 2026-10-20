using System.Xml.Linq;
using AwesomeAssertions;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Unit;

// Connection string, senhas e a chave do JWT ficam fora do repositório: User Secrets em dev, variável de ambiente no container.
public class SecretsTests
{
    private static readonly string ApiDir = Path.Combine(RepoRoot.Path, "apps", "api", "Vistoria.Api");

    public static TheoryData<string> AppSettingsFiles =>
        new(Directory.GetFiles(ApiDir, "appsettings*.json").Select(Path.GetFileName)!);

    [Theory]
    [MemberData(nameof(AppSettingsFiles))]
    public void AppSettings_HasNoConnectionStringNorPassword(string file)
    {
        var content = File.ReadAllText(Path.Combine(ApiDir, file));

        content.Should().NotContainEquivalentOf("ConnectionStrings")
            .And.NotContainEquivalentOf("Password")
            .And.NotContainEquivalentOf("Pwd=")
            .And.NotContainEquivalentOf("SigningKey");
    }

    [Fact]
    public void ApiProject_UsesUserSecrets()
    {
        var project = XDocument.Load(Path.Combine(ApiDir, "Vistoria.Api.csproj"));

        project.Descendants("UserSecretsId").Should().ContainSingle()
            .Which.Value.Should().NotBeNullOrWhiteSpace();
    }

    // ADR 0025: um .env.example só lista nomes. Valor de exemplo commitado vira senha pública de quem copia.
    [Fact]
    public void EnvExamples_HaveNoValues()
    {
        var examples = RepoFiles(".env.example").ToList();
        examples.Should().NotBeEmpty();

        var withValue = examples
            .SelectMany(file => File.ReadLines(file)
                .Select(line => line.Trim())
                .Where(line => line.Length > 0 && !line.StartsWith('#'))
                .Where(line => line[(line.IndexOf('=', StringComparison.Ordinal) + 1)..].Trim().Length > 0)
                .Select(line => $"{Path.GetRelativePath(RepoRoot.Path, file)}: {line[..line.IndexOf('=', StringComparison.Ordinal)]}"));

        withValue.Should().BeEmpty("o valor vai no .env local, gerado por pnpm db:init");
    }

    // Senha no compose só por interpolação do .env, nunca literal.
    [Fact]
    public void ComposeFiles_TakePasswordsFromEnv()
    {
        var literals = Directory.GetFiles(Path.Combine(RepoRoot.Path, "infra"), "docker-compose*.yml")
            .SelectMany(file => File.ReadLines(file)
                .Where(line => line.TrimStart().StartsWith("MSSQL_SA_PASSWORD:", StringComparison.Ordinal))
                .Where(line => !line.Contains("${MSSQL_SA_PASSWORD", StringComparison.Ordinal)));

        literals.Should().BeEmpty();
    }

    private static readonly HashSet<string> SkippedDirs = ["node_modules", ".git", "bin", "obj", ".next", "out"];

    private static IEnumerable<string> RepoFiles(string name)
    {
        var pending = new Stack<string>([RepoRoot.Path]);
        while (pending.TryPop(out var dir))
        {
            foreach (var file in Directory.EnumerateFiles(dir, name))
            {
                yield return file;
            }

            foreach (var sub in Directory.EnumerateDirectories(dir).Where(d => !SkippedDirs.Contains(Path.GetFileName(d))))
            {
                pending.Push(sub);
            }
        }
    }
}
