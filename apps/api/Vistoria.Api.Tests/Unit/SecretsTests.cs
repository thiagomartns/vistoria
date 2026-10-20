using System.Xml.Linq;
using AwesomeAssertions;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Unit;

// Connection string e senhas ficam fora do repositório: User Secrets em dev, variável de ambiente no container.
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
            .And.NotContainEquivalentOf("Pwd=");
    }

    [Fact]
    public void ApiProject_UsesUserSecrets()
    {
        var project = XDocument.Load(Path.Combine(ApiDir, "Vistoria.Api.csproj"));

        project.Descendants("UserSecretsId").Should().ContainSingle()
            .Which.Value.Should().NotBeNullOrWhiteSpace();
    }
}
