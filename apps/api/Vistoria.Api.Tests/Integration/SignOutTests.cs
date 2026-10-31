using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Net.Http.Headers;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// O cliente não guarda cookie: cada teste manda o refresh_token à mão (RefreshCookies).
public class SignOutTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string SignOut = "/api/v1/auth/signout";
    private const string Refresh = "/api/v1/auth/refresh";
    private const string Password = "senha de teste 123";

    private readonly HttpClient _client =
        factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    [Fact]
    public async Task ValidCookie_Returns204_RevokesTheWholeFamily_AndDeletesTheCookie()
    {
        var first = RefreshCookies.FromResponse(await SignUp(NewEmail())).Value.ToString();
        var current = RefreshCookies.FromResponse(await Post(Refresh, first)).Value.ToString();
        factory.Time.Advance(TimeSpan.FromMinutes(5));

        var response = await Post(SignOut, current);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).Should().BeEmpty();
        AssertDeleted(response);
        var family = await RefreshCookies.FamilyRows(factory, current);
        family.Should().HaveCount(2);
        family.Should().AllSatisfy(t => t.RevokedAt.Should().Be(factory.Time.GetUtcNow()));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nao-e-um-token")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")] // formato certo, nunca emitido
    public async Task MissingOrUnknownCookie_Returns204_AndDeletesTheCookie(string? cookie)
    {
        var response = await Post(SignOut, cookie);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        AssertDeleted(response);
    }

    [Fact]
    public async Task RefreshWithACookieFromBeforeTheSignOut_Returns401()
    {
        var first = RefreshCookies.FromResponse(await SignUp(NewEmail())).Value.ToString();
        var current = RefreshCookies.FromResponse(await Post(Refresh, first)).Value.ToString();
        (await Post(SignOut, current)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Dentro da tolerância, o anterior ainda daria um access token; depois do signout, nem ele nem o atual.
        await AssertUnauthorized(await Post(Refresh, current));
        await AssertUnauthorized(await Post(Refresh, first));
    }

    [Fact]
    public async Task SignOutTwice_Returns204BothTimes()
    {
        var cookie = RefreshCookies.FromResponse(await SignUp(NewEmail())).Value.ToString();

        (await Post(SignOut, cookie)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await Post(SignOut, cookie)).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task SignOutOnOneDevice_KeepsTheOtherSessionsOfTheSameUser()
    {
        var email = NewEmail();
        var phone = RefreshCookies.FromResponse(await SignUp(email)).Value.ToString();
        var laptop = RefreshCookies.FromResponse(await _client.PostAsJsonAsync("/api/v1/auth/signin",
            new { email, password = Password }, TestContext.Current.CancellationToken)).Value.ToString();

        (await Post(SignOut, phone)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        (await Post(Refresh, laptop)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await RefreshCookies.StoredToken(factory, laptop))!.RevokedAt.Should().BeNull();
    }

    private static string NewEmail() => $"{Guid.NewGuid():N}@teste.local";

    private Task<HttpResponseMessage> SignUp(string email) =>
        _client.PostAsJsonAsync("/api/v1/auth/signup", new { name = "Ana", email, password = Password },
            TestContext.Current.CancellationToken);

    private Task<HttpResponseMessage> Post(string path, string? cookie) =>
        _client.SendAsync(RefreshCookies.Post(path, cookie), TestContext.Current.CancellationToken);

    // Apagar é sobrescrever: valor vazio, Max-Age=0 e as mesmas opções do cookie emitido, com o mesmo Path.
    private static void AssertDeleted(HttpResponseMessage response)
    {
        var cookie = RefreshCookies.FromResponse(response);
        cookie.Value.ToString().Should().BeEmpty();
        cookie.MaxAge.Should().Be(TimeSpan.Zero);
        cookie.Expires.Should().Be(DateTimeOffset.UnixEpoch);
        cookie.Path.ToString().Should().Be("/api/v1/auth");
        cookie.HttpOnly.Should().BeTrue();
        cookie.Secure.Should().BeTrue();
        cookie.SameSite.Should().Be(SameSiteMode.Strict);
        response.Headers.GetValues(HeaderNames.SetCookie).Single().Should().Contain("max-age=0");
    }

    private static async Task AssertUnauthorized(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var body = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).RootElement;
        body.GetProperty("type").GetString().Should().Be(ProblemTypes.Unauthorized);
    }
}
