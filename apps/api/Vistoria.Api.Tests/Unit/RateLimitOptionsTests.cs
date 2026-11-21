using AwesomeAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Vistoria.Api.Configurations;

namespace Vistoria.Api.Tests.Unit;

// Os limites do rate limit vêm da seção RateLimit, com o padrão de backend.md; só o job e2e do CI os sobe (#197).
public class RateLimitOptionsTests
{
    [Fact]
    public void WithoutConfiguration_LimitsAreTheOnesInBackendMd()
    {
        var options = Resolve(new Dictionary<string, string?>());

        options.CredentialPermitLimit.Should().Be(5);
        options.RefreshPermitLimit.Should().Be(30);
    }

    [Fact]
    public void Configuration_ChangesBothLimits()
    {
        var options = Resolve(new Dictionary<string, string?>
        {
            ["RateLimit:CredentialPermitLimit"] = "1000",
            ["RateLimit:RefreshPermitLimit"] = "2000",
        });

        options.CredentialPermitLimit.Should().Be(1000);
        options.RefreshPermitLimit.Should().Be(2000);
    }

    [Theory]
    [InlineData("RateLimit:CredentialPermitLimit", "0")]
    [InlineData("RateLimit:RefreshPermitLimit", "-1")]
    public void LimitBelowOne_IsRejected(string key, string value)
    {
        var resolve = () => Resolve(new Dictionary<string, string?> { [key] = value });

        resolve.Should().Throw<OptionsValidationException>().WithMessage($"*{key}*maior que zero*");
    }

    private static RateLimitOptions Resolve(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        using var provider = new ServiceCollection()
            .AddSingleton<IConfiguration>(configuration)
            .AddRateLimits()
            .BuildServiceProvider();
        return provider.GetRequiredService<IOptions<RateLimitOptions>>().Value;
    }
}
