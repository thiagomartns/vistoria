using System.Net;
using System.Net.Http.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Hosting;
using Vistoria.Api.Configurations;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class CorsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string SignIn = "/api/v1/auth/signin";

    [Fact]
    public async Task Development_PreflightFromTheFront_IsAllowedWithCredentials()
    {
        var response = await factory.CreateClient().SendAsync(Preflight(CorsConfig.DevOrigin),
            TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Equal(CorsConfig.DevOrigin);
        response.Headers.GetValues("Access-Control-Allow-Credentials").Should().Equal("true");
    }

    [Fact]
    public async Task Development_ResponseExposesETagAndRetryAfter()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add("Origin", CorsConfig.DevOrigin);

        var response = await factory.CreateClient().SendAsync(request, TestContext.Current.CancellationToken);

        response.Headers.GetValues("Access-Control-Allow-Origin").Should().Equal(CorsConfig.DevOrigin);
        response.Headers.GetValues("Access-Control-Expose-Headers").SelectMany(v => v.Split(','))
            .Select(v => v.Trim()).Should().BeEquivalentTo("ETag", "Retry-After");
    }

    [Fact]
    public async Task Development_OtherOrigin_IsNotAllowed()
    {
        var response = await factory.CreateClient().SendAsync(Preflight("http://localhost:4000"),
            TestContext.Current.CancellationToken);

        response.Headers.Contains("Access-Control-Allow-Origin").Should().BeFalse();
    }

    // CORS antes do rate limit: o preflight responde sem gastar o limite do signin.
    [Fact]
    public async Task Development_Preflights_DoNotSpendTheSignInLimit()
    {
        var client = factory.CreateClient();
        for (var i = 0; i < 6; i++)
        {
            (await client.SendAsync(Preflight(CorsConfig.DevOrigin), TestContext.Current.CancellationToken))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        var response = await client.PostAsync(SignIn, JsonContent.Create(new { }), TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Production_HasNoCors()
    {
        await using var production = new ProductionApiFactory();
        await production.InitializeAsync();

        var preflight = await production.CreateClient().SendAsync(Preflight(CorsConfig.DevOrigin),
            TestContext.Current.CancellationToken);
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add("Origin", CorsConfig.DevOrigin);
        var simple = await production.CreateClient().SendAsync(request, TestContext.Current.CancellationToken);

        simple.StatusCode.Should().Be(HttpStatusCode.OK);
        preflight.Headers.Concat(simple.Headers).Select(h => h.Key)
            .Should().NotContain(h => h.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase));
    }

    private static HttpRequestMessage Preflight(string origin)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, SignIn);
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");
        return request;
    }

    private sealed class ProductionApiFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseEnvironment("Production");
        }
    }
}
