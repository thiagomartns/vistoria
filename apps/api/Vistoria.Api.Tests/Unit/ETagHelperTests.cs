using AwesomeAssertions;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Tests.Unit;

public class ETagHelperTests
{
    private static readonly byte[] Version = [0, 0, 0, 0, 0, 0, 0x07, 0xD1];

    [Fact]
    public void ToETag_IsStrongQuotedBase64()
    {
        ETagHelper.ToETag(Version).Should().Be("\"AAAAAAAAB9E=\"");
    }

    [Fact]
    public void TryParse_RoundTripsToETag()
    {
        ETagHelper.TryParse(ETagHelper.ToETag(Version), out var parsed).Should().BeTrue();

        parsed.Should().Equal(Version);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("\"")]
    [InlineData("\"\"")]
    [InlineData("AAAAAAAAB9E=")]            // sem aspas
    [InlineData("\"AAAAAAAAB9E=")]          // sem a aspa final
    [InlineData("AAAAAAAAB9E=\"")]          // sem a aspa inicial
    [InlineData("W/\"AAAAAAAAB9E=\"")]      // ETag fraca
    [InlineData("\"não é base64\"")]
    [InlineData("\"AAAAAAAAB9\"")]          // base64 truncado
    [InlineData("\"AAAAAAAAAAAA\"")]        // 9 bytes
    [InlineData("\"AAAAAA==\"")]            // 4 bytes
    [InlineData("*")]
    public void TryParse_RejectsInvalidInput(string? etag)
    {
        ETagHelper.TryParse(etag, out var parsed).Should().BeFalse();

        parsed.Should().BeEmpty();
    }
}
