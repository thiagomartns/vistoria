using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class SignInTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/auth/signin";
    private const string Password = "senha de teste 123";

    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task ValidSignIn_Returns200WithAccessTokenForTheUser()
    {
        var email = NewEmail();
        var signUp = await _client.PostAsJsonAsync("/api/v1/auth/signup",
            new { name = "Ana Vistoriadora", email, password = Password }, TestContext.Current.CancellationToken);
        var userId = (await ReadBody(signUp)).GetProperty("user").GetProperty("id").GetGuid();
        factory.Time.Advance(TimeSpan.FromHours(1));

        // E-mail com maiúsculas e espaços: a busca normaliza como o signup.
        var (response, body) = await SignIn(new { email = $" {email.ToUpperInvariant()} ", password = Password });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var expiresAt = body.GetProperty("expiresAt").GetDateTimeOffset();
        expiresAt.Should().Be(factory.Time.GetUtcNow() + TimeSpan.FromMinutes(15));
        body.GetProperty("user").GetProperty("id").GetGuid().Should().Be(userId);
        body.GetProperty("user").GetProperty("name").GetString().Should().Be("Ana Vistoriadora");
        var token = new JsonWebToken(body.GetProperty("accessToken").GetString()!);
        token.Subject.Should().Be(userId.ToString());
        token.ValidTo.Should().Be(expiresAt.UtcDateTime);
    }

    [Fact]
    public async Task WrongPasswordAndUnknownEmail_ReturnTheSameInvalidCredentials()
    {
        var email = NewEmail();
        await _client.PostAsJsonAsync("/api/v1/auth/signup", new { name = "Ana", email, password = Password },
            TestContext.Current.CancellationToken);

        var (wrongPassword, wrongPasswordBody) = await SignIn(new { email, password = Password + "x" });
        var (unknownEmail, unknownEmailBody) = await SignIn(new { email = NewEmail(), password = Password });

        AssertInvalidCredentials(wrongPassword, wrongPasswordBody);
        AssertInvalidCredentials(unknownEmail, unknownEmailBody);
        WithoutTraceId(wrongPasswordBody).Should().Be(WithoutTraceId(unknownEmailBody));
        wrongPassword.Headers.Select(h => h.Key).Should().BeEquivalentTo(unknownEmail.Headers.Select(h => h.Key));
    }

    [Fact]
    public async Task HashInOldFormat_IsRehashedOnSuccessfulSignIn()
    {
        var email = NewEmail();
        var user = new User { Id = Guid.CreateVersion7(), Name = "Ana", Email = email, CreatedAt = ApiFactory.Start };
        var oldHasher = new PasswordHasher<User>(Options.Create(
            new PasswordHasherOptions { CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV2 }));
        user.PasswordHash = oldHasher.HashPassword(user, Password);
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Users.Add(user);
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        var hasher = new PasswordHasher<User>();
        hasher.VerifyHashedPassword(user, user.PasswordHash, Password)
            .Should().Be(PasswordVerificationResult.SuccessRehashNeeded);

        var (response, _) = await SignIn(new { email, password = Password });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var stored = await StoredHash(user.Id);
        stored.Should().NotBe(user.PasswordHash);
        hasher.VerifyHashedPassword(user, stored, Password).Should().Be(PasswordVerificationResult.Success);
    }

    [Fact]
    public async Task WrongPassword_DoesNotTouchTheStoredHash()
    {
        var email = NewEmail();
        var signUp = await _client.PostAsJsonAsync("/api/v1/auth/signup", new { name = "Ana", email, password = Password },
            TestContext.Current.CancellationToken);
        var userId = (await ReadBody(signUp)).GetProperty("user").GetProperty("id").GetGuid();
        var before = await StoredHash(userId);

        var (response, body) = await SignIn(new { email, password = "outra senha qualquer" });

        AssertInvalidCredentials(response, body);
        (await StoredHash(userId)).Should().Be(before);
    }

    [Fact]
    public async Task EmptyBody_Returns400OnEmailAndPassword()
    {
        var (response, body) = await SignIn(new { });

        AssertValidation(response, body).Should().BeEquivalentTo("email", "password");
    }

    [Fact]
    public async Task PasswordOverTheLimit_Returns400WithoutHashing()
    {
        var (response, body) = await SignIn(new { email = NewEmail(), password = new string('x', 129) });

        AssertValidation(response, body).Should().Equal("password");
    }

    private static string NewEmail() => $"{Guid.NewGuid():N}@teste.local";

    private async Task<(HttpResponseMessage Response, JsonElement Body)> SignIn(object body)
    {
        var response = await _client.PostAsJsonAsync(Path, body, TestContext.Current.CancellationToken);
        return (response, await ReadBody(response));
    }

    private static async Task<JsonElement> ReadBody(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).RootElement;

    private async Task<string> StoredHash(Guid userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Users.Where(u => u.Id == userId).Select(u => u.PasswordHash)
            .SingleAsync(TestContext.Current.CancellationToken);
    }

    private static void AssertInvalidCredentials(HttpResponseMessage response, JsonElement body)
    {
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        body.GetProperty("type").GetString().Should().Be(ProblemTypes.InvalidCredentials);
    }

    private static List<string> AssertValidation(HttpResponseMessage response, JsonElement body)
    {
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        body.GetProperty("type").GetString().Should().Be(ProblemTypes.Validation);
        return body.GetProperty("errors").EnumerateObject().Select(p => p.Name).ToList();
    }

    private static string WithoutTraceId(JsonElement body) =>
        JsonSerializer.Serialize(body.EnumerateObject().Where(p => p.Name != "traceId")
            .ToDictionary(p => p.Name, p => p.Value));
}
