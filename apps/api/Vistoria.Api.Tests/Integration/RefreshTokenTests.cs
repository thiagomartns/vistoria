using System.Buffers.Text;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.Net.Http.Headers;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// O cliente não guarda cookie: cada teste manda o refresh_token à mão (RefreshCookies).
public class RefreshTokenTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Refresh = "/api/v1/auth/refresh";
    private const string Password = "senha de teste 123";

    private readonly HttpClient _client =
        factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    [Theory]
    [InlineData("signup")]
    [InlineData("signin")]
    public async Task SignUpAndSignIn_SetTheCookie_AndTheDatabaseKeepsOnlyTheHash(string endpoint)
    {
        var email = NewEmail();
        var signUp = await SignUp(email);
        var response = endpoint == "signup"
            ? signUp
            : await _client.PostAsJsonAsync("/api/v1/auth/signin", new { email, password = Password },
                TestContext.Current.CancellationToken);

        response.IsSuccessStatusCode.Should().BeTrue();
        var cookie = SingleRefreshCookie(response);
        cookie.HttpOnly.Should().BeTrue();
        cookie.Secure.Should().BeTrue();
        cookie.SameSite.Should().Be(SameSiteMode.Strict);
        cookie.Path.ToString().Should().Be("/api/v1/auth");
        cookie.Expires.Should().Be(factory.Time.GetUtcNow() + TimeSpan.FromDays(7));

        var value = cookie.Value.ToString();
        Base64Url.DecodeFromChars(value).Should().HaveCount(32);
        var row = await StoredToken(value);
        row.Should().NotBeNull();
        row!.UserId.Should().Be(await UserId(signUp));
        row.ExpiresAt.Should().Be(factory.Time.GetUtcNow() + TimeSpan.FromDays(7));
        JsonSerializer.Serialize(row).Should().NotContain(value);
    }

    [Fact]
    public async Task ValidRefresh_ReturnsANewAccessTokenAndCookie_AndReplacesTheOldOne()
    {
        var signUp = await SignUp(NewEmail());
        var userId = await UserId(signUp);
        var first = SingleRefreshCookie(signUp).Value.ToString();
        factory.Time.Advance(TimeSpan.FromHours(1));

        var response = await PostRefresh(first);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadBody(response);
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("accessToken", "expiresAt");
        body.GetProperty("expiresAt").GetDateTimeOffset()
            .Should().Be(factory.Time.GetUtcNow() + TimeSpan.FromMinutes(15));
        new JsonWebToken(body.GetProperty("accessToken").GetString()!).Subject.Should().Be(userId.ToString());

        var second = SingleRefreshCookie(response);
        second.Value.ToString().Should().NotBe(first);
        second.Expires.Should().Be(factory.Time.GetUtcNow() + TimeSpan.FromDays(7));
        var old = (await StoredToken(first))!;
        var successor = (await StoredToken(second.Value.ToString()))!;
        old.ReplacedAt.Should().Be(factory.Time.GetUtcNow());
        successor.FamilyId.Should().Be(old.FamilyId);
        successor.FamilyCreatedAt.Should().Be(old.FamilyCreatedAt);
        successor.ReplacedAt.Should().BeNull();

        // O sucessor também renova.
        (await PostRefresh(second.Value.ToString())).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SameCookieTwiceWithinTheGrace_BothSucceed_AndTheSecondHasNoSetCookie()
    {
        var cookie = SingleRefreshCookie(await SignUp(NewEmail())).Value.ToString();

        var first = await PostRefresh(cookie);
        factory.Time.Advance(TimeSpan.FromSeconds(29));
        var second = await PostRefresh(cookie);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        second.Headers.Contains(HeaderNames.SetCookie).Should().BeFalse();
        (await ReadBody(second)).GetProperty("accessToken").GetString().Should().NotBeNullOrEmpty();
        // A segunda não emitiu nem revogou nada: o sucessor da primeira segue valendo.
        (await FamilyRows(cookie)).Should().HaveCount(2);
        (await PostRefresh(SingleRefreshCookie(first).Value.ToString())).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SameCookieInParallel_BothSucceed_WithASingleSuccessor()
    {
        var cookie = SingleRefreshCookie(await SignUp(NewEmail())).Value.ToString();

        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => PostRefresh(cookie)));

        responses.Should().AllSatisfy(r => r.StatusCode.Should().Be(HttpStatusCode.OK));
        responses.Count(r => r.Headers.Contains(HeaderNames.SetCookie)).Should().Be(1);
        (await FamilyRows(cookie)).Should().HaveCount(2);
    }

    [Fact]
    public async Task SameCookieAfterTheGrace_Returns401_AndRevokesTheWholeFamily()
    {
        var cookie = SingleRefreshCookie(await SignUp(NewEmail())).Value.ToString();
        var successor = SingleRefreshCookie(await PostRefresh(cookie)).Value.ToString();
        factory.Time.Advance(TimeSpan.FromSeconds(30));

        var reused = await PostRefresh(cookie);

        await AssertUnauthorized(reused);
        reused.Headers.Contains(HeaderNames.SetCookie).Should().BeFalse();
        (await FamilyRows(cookie)).Should().AllSatisfy(t => t.RevokedAt.Should().Be(factory.Time.GetUtcNow()));
        await AssertUnauthorized(await PostRefresh(successor));
    }

    [Fact]
    public async Task FamilyOlderThan30Days_Returns401()
    {
        var cookie = SingleRefreshCookie(await SignUp(NewEmail())).Value.ToString();
        for (var i = 0; i < 4; i++)
        {
            factory.Time.Advance(TimeSpan.FromDays(6));
            var renewed = await PostRefresh(cookie);
            renewed.StatusCode.Should().Be(HttpStatusCode.OK);
            cookie = SingleRefreshCookie(renewed).Value.ToString();
        }

        // Aos 24 dias, o prazo do último token já para no teto da família, não em mais 7 dias.
        (await StoredToken(cookie))!.ExpiresAt.Should().Be(factory.Time.GetUtcNow() + TimeSpan.FromDays(6));
        factory.Time.Advance(TimeSpan.FromDays(6));

        await AssertUnauthorized(await PostRefresh(cookie));
    }

    [Fact]
    public async Task TokenUnusedFor7Days_Returns401_WithoutRevokingTheFamily()
    {
        var cookie = SingleRefreshCookie(await SignUp(NewEmail())).Value.ToString();
        factory.Time.Advance(TimeSpan.FromDays(7));

        await AssertUnauthorized(await PostRefresh(cookie));
        (await StoredToken(cookie))!.RevokedAt.Should().BeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nao-e-um-token")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")] // formato certo, nunca emitido
    public async Task MissingOrUnknownCookie_Returns401(string? cookie)
    {
        await AssertUnauthorized(await PostRefresh(cookie));
    }

    private static string NewEmail() => $"{Guid.NewGuid():N}@teste.local";

    private Task<HttpResponseMessage> SignUp(string email) =>
        _client.PostAsJsonAsync("/api/v1/auth/signup", new { name = "Ana", email, password = Password },
            TestContext.Current.CancellationToken);

    private Task<HttpResponseMessage> PostRefresh(string? cookie) =>
        _client.SendAsync(RefreshCookies.Post(Refresh, cookie), TestContext.Current.CancellationToken);

    private static SetCookieHeaderValue SingleRefreshCookie(HttpResponseMessage response) =>
        RefreshCookies.FromResponse(response);

    private static async Task<Guid> UserId(HttpResponseMessage signUp) =>
        (await ReadBody(signUp)).GetProperty("user").GetProperty("id").GetGuid();

    private static async Task<JsonElement> ReadBody(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).RootElement;

    private static async Task AssertUnauthorized(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await ReadBody(response)).GetProperty("type").GetString().Should().Be(ProblemTypes.Unauthorized);
    }

    private Task<RefreshToken?> StoredToken(string cookie) => RefreshCookies.StoredToken(factory, cookie);

    private Task<List<RefreshToken>> FamilyRows(string cookie) => RefreshCookies.FamilyRows(factory, cookie);
}
