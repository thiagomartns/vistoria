using System.Security.Cryptography;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Auth;

namespace Vistoria.Api.Tests.Unit;

// Sem chave válida a API não sobe (ValidateOnStart): a chave vem de User Secrets ou de variável de ambiente.
public class JwtOptionsTests
{
    private readonly JwtOptionsValidator _validator = new();

    [Fact]
    public void KeyOf32RandomBytes_IsAccepted()
    {
        _validator.Validate(null, Options(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))))
            .Succeeded.Should().BeTrue();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("nao é base64")]
    public void MissingOrUnreadableKey_IsRejected(string key)
    {
        var result = _validator.Validate(null, Options(key));

        result.Failed.Should().BeTrue();
        result.FailureMessage.Should().Contain("SigningKey");
    }

    [Fact]
    public void KeyShorterThan256Bits_IsRejected()
    {
        _validator.Validate(null, Options(Convert.ToBase64String(RandomNumberGenerator.GetBytes(31))))
            .FailureMessage.Should().Contain("32 bytes");
    }

    [Fact]
    public void MissingIssuerOrAudience_IsRejected()
    {
        var key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

        _validator.Validate(null, new JwtOptions { SigningKey = key }).FailureMessage
            .Should().Contain("Issuer").And.Contain("Audience");
    }

    private static JwtOptions Options(string key) => new() { Issuer = "vistoria", Audience = "vistoria", SigningKey = key };
}
