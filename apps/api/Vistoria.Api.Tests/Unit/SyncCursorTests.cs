using AwesomeAssertions;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Tests.Unit;

public class SyncCursorTests
{
    private static readonly SyncCursor Cursor =
        new([0, 0, 0, 0, 0, 0, 0x07, 0xD1], new DateTimeOffset(2026, 10, 20, 12, 0, 0, TimeSpan.Zero));

    [Fact]
    public void Encode_RoundTripsThroughTryParse()
    {
        SyncCursor.TryParse(Cursor.Encode(), out var parsed).Should().BeTrue();

        parsed.Version.Should().Equal(Cursor.Version);
        parsed.IssuedAt.Should().Be(Cursor.IssuedAt);
    }

    // Vai na query string sem escape.
    [Fact]
    public void Encode_IsBase64UrlWithoutPadding()
    {
        Cursor.Encode().Should().MatchRegex("^[A-Za-z0-9_-]+$");
    }

    [Fact]
    public void Start_IsVersionZero()
    {
        SyncCursor.Start(Cursor.IssuedAt).Version.Should().Equal(new byte[8]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("isso não é base64!")]
    [InlineData("bm90IGpzb24")]                                      // "not json"
    [InlineData("W10")]                                              // []
    [InlineData("e30")]                                              // {}
    [InlineData("eyJpc3N1ZWRBdCI6IjIwMjYtMTAtMjBUMTI6MDA6MDBaIn0")]  // sem versão
    [InlineData("eyJ2ZXJzaW9uIjoiQUFBQUFBQUFCOUU9In0")]              // sem issuedAt
    [InlineData("eyJ2ZXJzaW9uIjoiQUFBQUFBQUFBQT09IiwiaXNzdWVkQXQiOiIyMDI2LTEwLTIwVDEyOjAwOjAwWiJ9")] // 7 bytes
    [InlineData("eyJ2ZXJzaW9uIjoiIyMjIiwiaXNzdWVkQXQiOiIyMDI2LTEwLTIwVDEyOjAwOjAwWiJ9")]             // versão "###"
    [InlineData("eyJ2ZXJzaW9uIjoxLCJpc3N1ZWRBdCI6IjIwMjYtMTAtMjBUMTI6MDA6MDBaIn0")]                // versão número
    public void TryParse_RejectsWhatIsNotACursor(string? value)
    {
        SyncCursor.TryParse(value, out _).Should().BeFalse();
    }
}
