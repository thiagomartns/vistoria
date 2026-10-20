using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class AuthenticationTests(TestControllersFactory factory) : IClassFixture<TestControllersFactory>
{
    private const string ProtectedPath = "/test/protected";

    [Fact]
    public async Task ProtectedRoute_WithSignUpToken_Returns200WithTheUser()
    {
        var (client, userId) = await SignedUpClient();

        var response = await client.GetAsync(ProtectedPath, TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadBody(response)).GetProperty("sub").GetString().Should().Be(userId.ToString());
    }

    [Fact]
    public async Task ProtectedRoute_WithoutToken_Returns401Unauthorized()
    {
        var response = await factory.CreateClient().GetAsync(ProtectedPath, TestContext.Current.CancellationToken);

        await AssertUnauthorized(response);
    }

    [Fact]
    public async Task Token_ValidUntilExpiresAtByTheFakeClock()
    {
        var (client, _) = await SignedUpClient();

        factory.Time.Advance(TimeSpan.FromMinutes(15) - TimeSpan.FromSeconds(1));
        (await client.GetAsync(ProtectedPath, TestContext.Current.CancellationToken)).StatusCode
            .Should().Be(HttpStatusCode.OK);

        factory.Time.Advance(TimeSpan.FromSeconds(1));
        await AssertUnauthorized(await client.GetAsync(ProtectedPath, TestContext.Current.CancellationToken));
    }

    // Tudo o que o JwtBearer recusa sai igual: 401 unauthorized, sem dizer o motivo.
    [Theory]
    [InlineData("nao-e-um-jwt")]
    [InlineData("outra-chave")]
    [InlineData("outra-audiencia")]
    [InlineData("outro-emissor")]
    [InlineData("hs512")]
    [InlineData("sem-exp")]
    public async Task ProtectedRoute_WithInvalidToken_Returns401Unauthorized(string kind)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ForgedToken(kind));

        await AssertUnauthorized(await client.GetAsync(ProtectedPath, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task ForgedTokenWithTheFactoryKey_IsAccepted()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ForgedToken("valido"));

        (await client.GetAsync(ProtectedPath, TestContext.Current.CancellationToken)).StatusCode
            .Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("/api/v1/health")]
    [InlineData("/openapi/v1.json")]
    [InlineData("/swagger/index.html")]
    public async Task PublicRoutes_AnswerWithoutToken(string path)
    {
        var response = await factory.CreateClient().GetAsync(path, TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UnknownRoute_WithoutToken_Returns401BeforeRouting()
    {
        var response = await factory.CreateClient()
            .GetAsync("/api/v1/rota-que-nao-existe", TestContext.Current.CancellationToken);

        await AssertUnauthorized(response);
    }

    private async Task<(HttpClient Client, Guid UserId)> SignedUpClient()
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/signup",
            new { name = "Ana", email = $"{Guid.NewGuid():N}@teste.local", password = "senha de teste 123" },
            TestContext.Current.CancellationToken);
        var body = await ReadBody(response);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
        return (client, body.GetProperty("user").GetProperty("id").GetGuid());
    }

    private static async Task AssertUnauthorized(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        response.Headers.WwwAuthenticate.Select(h => h.Scheme).Should().Equal("Bearer");
        var body = await ReadBody(response);
        body.GetProperty("type").GetString().Should().Be(ProblemTypes.Unauthorized);
        body.GetProperty("status").GetInt32().Should().Be(401);
        body.GetProperty("traceId").GetString().Should().NotBeNullOrWhiteSpace();
    }

    private static async Task<JsonElement> ReadBody(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).RootElement;

    // "valido" é o controle: com ele, só o que o caso muda explica o 401.
    private string ForgedToken(string kind)
    {
        if (kind == "nao-e-um-jwt")
        {
            return kind;
        }

        var key = kind == "outra-chave"
            ? RandomNumberGenerator.GetBytes(64)
            : Convert.FromBase64String(factory.JwtSigningKey);
        var now = factory.Time.GetUtcNow().UtcDateTime;
        return new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = kind == "outro-emissor" ? "outra-api" : "vistoria",
            Audience = kind == "outra-audiencia" ? "outra-api" : "vistoria",
            IssuedAt = now,
            NotBefore = now,
            Expires = kind == "sem-exp" ? null : now.AddMinutes(15),
            Subject = new ClaimsIdentity([new Claim(JwtRegisteredClaimNames.Sub, Guid.CreateVersion7().ToString())]),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key),
                kind == "hs512" ? SecurityAlgorithms.HmacSha512 : SecurityAlgorithms.HmacSha256),
        });
    }
}
