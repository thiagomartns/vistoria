using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Cada CreateClient() tem um IP próprio (ApiFactory), então cada teste começa com o balde cheio.
public class RateLimitTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string SignIn = "/api/v1/auth/signin";
    private const string SignUp = "/api/v1/auth/signup";
    private const string Refresh = "/api/v1/auth/refresh";

    // Corpo vazio: 400 barato, sem PBKDF2 nem banco. O limite conta antes da validação.
    [Theory]
    [InlineData(SignIn)]
    [InlineData(SignUp)]
    public async Task SixthCallInAMinute_Returns429RateLimitedWithRetryAfter(string path)
    {
        var client = factory.CreateClient();

        var firstFive = await Post(client, path, times: 5);
        var sixth = await PostOnce(client, path);

        firstFive.Should().AllSatisfy(r => r.StatusCode.Should().Be(HttpStatusCode.BadRequest));
        sixth.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        sixth.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        var body = JsonDocument.Parse(await sixth.Content.ReadAsStringAsync(TestContext.Current.CancellationToken))
            .RootElement;
        body.GetProperty("type").GetString().Should().Be(ProblemTypes.RateLimited);
        body.GetProperty("status").GetInt32().Should().Be(429);
        int.Parse(sixth.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture)
            .Should().BeInRange(1, 60);
    }

    [Fact]
    public async Task SignInWithTheRightPassword_IsAlsoLimited()
    {
        var client = factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@teste.local";
        const string password = "senha de teste 123";
        var signUp = await client.PostAsJsonAsync(SignUp, new { name = "Ana", email, password },
            TestContext.Current.CancellationToken);
        signUp.StatusCode.Should().Be(HttpStatusCode.Created);

        await Post(client, SignIn, times: 5);
        var response = await client.PostAsJsonAsync(SignIn, new { email, password }, TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task ExhaustedSignIn_DoesNotLimitSignUpNorAnotherIp()
    {
        var client = factory.CreateClient();
        await Post(client, SignIn, times: 6);

        (await PostOnce(client, SignIn)).StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        (await PostOnce(client, SignUp)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await PostOnce(factory.CreateClient(), SignIn)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // Sem cookie: 401 barato, sem banco. O limite conta antes da autenticação do refresh.
    [Fact]
    public async Task ThirtyFirstRefreshInAMinute_Returns429RateLimitedWithRetryAfter_WithoutLimitingSignIn()
    {
        var client = factory.CreateClient();

        var firstThirty = await Post(client, Refresh, times: 30);
        var thirtyFirst = await PostOnce(client, Refresh);

        firstThirty.Should().AllSatisfy(r => r.StatusCode.Should().Be(HttpStatusCode.Unauthorized));
        thirtyFirst.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        var body = JsonDocument.Parse(await thirtyFirst.Content.ReadAsStringAsync(TestContext.Current.CancellationToken))
            .RootElement;
        body.GetProperty("type").GetString().Should().Be(ProblemTypes.RateLimited);
        int.Parse(thirtyFirst.Headers.GetValues("Retry-After").Single(),
            System.Globalization.CultureInfo.InvariantCulture).Should().BeInRange(1, 60);
        (await PostOnce(client, SignIn)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    private static async Task<HttpResponseMessage[]> Post(HttpClient client, string path, int times)
    {
        var responses = new HttpResponseMessage[times];
        for (var i = 0; i < times; i++)
        {
            responses[i] = await PostOnce(client, path);
        }

        return responses;
    }

    private static Task<HttpResponseMessage> PostOnce(HttpClient client, string path) =>
        client.PostAsJsonAsync(path, new { }, TestContext.Current.CancellationToken);
}
