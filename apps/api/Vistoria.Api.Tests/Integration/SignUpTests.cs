using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class SignUpTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/auth/signup";
    private const string Password = "senha de teste 123";

    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task ValidSignUp_Returns201WithAccessTokenForTheNewUser()
    {
        var (response, body) = await SignUp(new { name = "Ana Vistoriadora", email = NewEmail(), password = Password });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var expiresAt = body.GetProperty("expiresAt").GetDateTimeOffset();
        expiresAt.Should().Be(factory.Time.GetUtcNow() + TimeSpan.FromMinutes(15));
        var user = body.GetProperty("user");
        var userId = user.GetProperty("id").GetGuid();
        userId.Version.Should().Be(7);
        user.GetProperty("name").GetString().Should().Be("Ana Vistoriadora");

        // Assinado com a chave da factory, nunca com uma do appsettings.
        var token = await ValidateToken(body.GetProperty("accessToken").GetString()!);
        token.Subject.Should().Be(userId.ToString());
        token.IssuedAt.Should().Be(factory.Time.GetUtcNow().UtcDateTime);
        token.ValidTo.Should().Be(expiresAt.UtcDateTime);
    }

    [Fact]
    public async Task Password_IsStoredOnlyAsVerifiableHash()
    {
        var email = NewEmail();
        var (_, body) = await SignUp(new { name = "Ana", email = $"  {email.ToUpperInvariant()} ", password = Password });
        var id = body.GetProperty("user").GetProperty("id").GetGuid();

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == id, TestContext.Current.CancellationToken);

        user.Email.Should().Be(email);
        user.PasswordHash.Should().NotBe(Password).And.NotContain(Password);
        new PasswordHasher<User>().VerifyHashedPassword(user, user.PasswordHash, Password)
            .Should().Be(PasswordVerificationResult.Success);
    }

    [Fact]
    public async Task EmailAlreadyUsed_IgnoringCase_Returns400OnEmail()
    {
        var email = NewEmail();
        (await SignUp(new { name = "Ana", email, password = Password })).Response.StatusCode
            .Should().Be(HttpStatusCode.Created);

        var (response, body) = await SignUp(new { name = "Outra", email = email.ToUpperInvariant(), password = Password });

        Errors(response, body).Keys.Should().Equal("email");
    }

    [Fact]
    public async Task SameEmailInParallel_OnlyOneAccountIsCreated()
    {
        var email = NewEmail();

        var responses = await Task.WhenAll(Enumerable.Range(0, 4)
            .Select(_ => SignUp(new { name = "Ana", email, password = Password })));

        responses.Select(r => r.Response.StatusCode).Should().ContainSingle(s => s == HttpStatusCode.Created);
        responses.Where(r => r.Response.StatusCode != HttpStatusCode.Created)
            .Should().AllSatisfy(r => Errors(r.Response, r.Body).Keys.Should().Equal("email"));
    }

    private const string ValidEmail = "(e-mail novo)";

    public static TheoryData<string, string, string, string> InvalidFields => new()
    {
        { "", ValidEmail, Password, "name" },
        { "A", ValidEmail, Password, "name" },
        { new string('a', 121), ValidEmail, Password, "name" },
        { "Ana", "nao-e-email", Password, "email" },
        { "Ana", ValidEmail, "1234567", "password" },
        { "Ana", ValidEmail, new string('x', 129), "password" },
    };

    [Theory]
    [MemberData(nameof(InvalidFields))]
    public async Task InvalidField_Returns400WithCamelCaseKey(string name, string email, string password, string key)
    {
        var (response, body) = await SignUp(new { name, email = email == ValidEmail ? NewEmail() : email, password });

        Errors(response, body).Keys.Should().Equal(key);
    }

    [Fact]
    public async Task EmptyBody_ReportsEveryFieldInCamelCase()
    {
        var (response, body) = await SignUp(new { });

        Errors(response, body).Keys.Should().BeEquivalentTo("name", "email", "password");
    }

    private static string NewEmail() => $"{Guid.NewGuid():N}@teste.local";

    private async Task<(HttpResponseMessage Response, JsonElement Body)> SignUp(object body)
    {
        var response = await _client.PostAsJsonAsync(Path, body, TestContext.Current.CancellationToken);
        var raw = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        return (response, JsonDocument.Parse(raw).RootElement);
    }

    private static Dictionary<string, string[]> Errors(HttpResponseMessage response, JsonElement body)
    {
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        body.GetProperty("type").GetString().Should().Be(ProblemTypes.Validation);
        return body.GetProperty("errors").EnumerateObject().ToDictionary(
            p => p.Name,
            p => p.Value.EnumerateArray().Select(m => m.GetString()!).ToArray());
    }

    // O relógio da factory está parado no passado: a validade é conferida pelos claims, não pelo relógio real.
    private async Task<JsonWebToken> ValidateToken(string token)
    {
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidIssuer = "vistoria",
            ValidAudience = "vistoria",
            IssuerSigningKey = new SymmetricSecurityKey(Convert.FromBase64String(factory.JwtSigningKey)),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            ValidateLifetime = false,
        });

        result.IsValid.Should().BeTrue(result.Exception?.Message);
        return (JsonWebToken)result.SecurityToken;
    }
}
