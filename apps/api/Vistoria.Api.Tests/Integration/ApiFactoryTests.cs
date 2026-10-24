using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Cada host de teste que observa appsettings e User Secrets gasta instâncias de inotify (limite de 128 no Linux).
// Com o dotnet watch do pnpm dev:api aberto, a suíte estourava o limite.
public class ApiFactoryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public void Host_DoesNotWatchConfigurationFiles() =>
        FileSources(factory).Should().NotBeEmpty().And.AllSatisfy(s => s.ReloadOnChange.Should().BeFalse(s.Path));

    [Fact]
    public void DerivedHost_DoesNotWatchConfigurationFiles()
    {
        using var derived = factory.WithWebHostBuilder(_ => { });

        FileSources(derived).Should().NotBeEmpty().And.AllSatisfy(s => s.ReloadOnChange.Should().BeFalse(s.Path));
    }

    private static List<FileConfigurationSource> FileSources(WebApplicationFactory<Program> host) =>
        Providers((IConfigurationRoot)host.Services.GetRequiredService<IConfiguration>())
            .OfType<FileConfigurationProvider>()
            .Select(p => p.Source)
            .ToList();

    // A configuração do host chega à do app embrulhada num ChainedConfigurationProvider.
    private static IEnumerable<IConfigurationProvider> Providers(IConfigurationRoot root) =>
        root.Providers.SelectMany(p => p is ChainedConfigurationProvider { Configuration: IConfigurationRoot inner }
            ? Providers(inner)
            : [p]);
}
