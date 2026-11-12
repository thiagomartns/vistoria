using System.Net;
using System.Net.Http.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Vistoria.Api.Configurations;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// O rate limit atrás do Caddy (backend.md, "Ambientes e hospedagem"): o X-Forwarded-For só vale vindo do proxy
// configurado. O IP de quem fala com a API é o X-Test-Remote-Ip da ApiFactory.
public class ForwardedHeadersTests
{
    private const string SignIn = "/api/v1/auth/signin";
    private const string Proxy = "10.0.0.1";

    [Fact]
    public async Task FromTheProxy_EachForwardedIpHasItsOwnBucket()
    {
        await using var factory = new BehindProxyApiFactory();
        await factory.InitializeAsync();
        var client = ClientFrom(factory, Proxy);

        var fromA = await SignIns(client, "203.0.113.10", times: 6);
        var fromB = await SignIns(client, "203.0.113.20", times: 1);

        fromA[..5].Should().AllSatisfy(r => r.StatusCode.Should().Be(HttpStatusCode.BadRequest));
        fromA[5].StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        fromB.Single().StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task FromOutsideTheProxy_AForgedForwardedIp_DoesNotEscapeTheLimit()
    {
        await using var factory = new BehindProxyApiFactory();
        await factory.InitializeAsync();
        var client = ClientFrom(factory, "198.51.100.7");

        var responses = await SignInsWithANewForwardedIpEachTime(client, times: 6);

        responses[5].StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    // O padrão do ASP.NET Core confia no loopback; aqui, sem proxy configurado, não confia em ninguém.
    [Fact]
    public async Task WithoutAConfiguredProxy_NotEvenLoopbackIsTrusted()
    {
        await using var factory = new ApiFactory();
        await factory.InitializeAsync();
        var client = ClientFrom(factory, IPAddress.Loopback.ToString());

        var responses = await SignInsWithANewForwardedIpEachTime(client, times: 6);

        responses[5].StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    private static HttpClient ClientFrom(ApiFactory factory, string remoteIp)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Remove(ApiFactory.RemoteIpHeader);
        client.DefaultRequestHeaders.Add(ApiFactory.RemoteIpHeader, remoteIp);
        return client;
    }

    private static async Task<HttpResponseMessage[]> SignIns(HttpClient client, string forwardedFor, int times)
    {
        var responses = new HttpResponseMessage[times];
        for (var i = 0; i < times; i++)
        {
            responses[i] = await SignInAs(client, forwardedFor);
        }

        return responses;
    }

    private static async Task<HttpResponseMessage[]> SignInsWithANewForwardedIpEachTime(HttpClient client, int times)
    {
        var responses = new HttpResponseMessage[times];
        for (var i = 0; i < times; i++)
        {
            responses[i] = await SignInAs(client, $"203.0.113.{100 + i}");
        }

        return responses;
    }

    // Corpo vazio: 400 barato, sem PBKDF2 nem banco. O limite conta antes da validação.
    private static Task<HttpResponseMessage> SignInAs(HttpClient client, string forwardedFor)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, SignIn) { Content = JsonContent.Create(new { }) };
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        return client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private sealed class BehindProxyApiFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(
                new Dictionary<string, string?> { [$"{ProxyConfig.KnownProxiesKey}:0"] = Proxy }));
        }
    }
}
