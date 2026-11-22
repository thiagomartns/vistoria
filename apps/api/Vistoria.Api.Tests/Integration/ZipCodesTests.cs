using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Infrastructure.ZipCodes;
using Vistoria.Api.Model;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// A consulta do CEP (#185). Cada teste sobe o próprio host, com os provedores falsos dele: o cache e o circuit breaker
// são do host, e um teste com o provedor fora não abre o circuito do seguinte.
public class ZipCodesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ZipCode = "01310100";

    private const string ViaCepPaulista = """
        { "cep": "01310-100", "logradouro": "  Avenida Paulista ", "complemento": "de 612 a 1510 - lado par",
          "bairro": "Bela Vista", "localidade": "São Paulo", "uf": "sp", "ibge": "3550308" }
        """;

    private const string BrasilApiComercio = """
        { "cep": "40010000", "state": "BA", "city": "Salvador", "neighborhood": "Comércio",
          "street": "Avenida Estados Unidos", "service": "open-cep" }
        """;

    [Fact]
    public async Task ViaCepAnswers_TheAddressComesNormalized_WithoutCallingBrasilApi()
    {
        using var host = Start(FakeProviderHandler.Json(HttpStatusCode.OK, ViaCepPaulista), Down());

        var response = await host.Get(ZipCode);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await Json(response);
        body.GetProperty("zipCode").GetString().Should().Be(ZipCode);
        body.GetProperty("street").GetString().Should().Be("Avenida Paulista");
        body.GetProperty("district").GetString().Should().Be("Bela Vista");
        body.GetProperty("city").GetString().Should().Be("São Paulo");
        body.GetProperty("state").GetString().Should().Be("SP");
        host.ViaCep.Paths.Should().Equal($"/ws/{ZipCode}/json/");
        host.BrasilApi.Calls.Should().Be(0);
    }

    [Fact]
    public async Task LongFieldsAreCutToTheModelLimits_AndAStateOutsideTheList_ComesNull()
    {
        var street = new string('a', 119) + "bcdef";
        var district = new string('b', 70);
        using var host = Start(
            FakeProviderHandler.Json(HttpStatusCode.OK, $$"""
                { "logradouro": "{{street}}", "bairro": "{{district}}", "localidade": "Cidade", "uf": "XX" }
                """),
            Down());

        var body = await Json(await host.Get(ZipCode));

        body.GetProperty("street").GetString().Should().Be(street[..120]);
        body.GetProperty("district").GetString().Should().HaveLength(60);
        body.GetProperty("state").ValueKind.Should().Be(JsonValueKind.Null);
    }

    // CEP geral de cidade pequena: sem rua nem bairro, o front preenche só cidade e UF.
    [Fact]
    public async Task CityWideZipCode_ComesWithoutStreetAndDistrict()
    {
        using var host = Start(
            FakeProviderHandler.Json(HttpStatusCode.OK, """
                { "cep": "35460-000", "logradouro": "", "bairro": " ", "localidade": "Brumadinho", "uf": "MG" }
                """),
            Down());

        var body = await Json(await host.Get("35460000"));

        body.GetProperty("street").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("district").ValueKind.Should().Be(JsonValueKind.Null);
        body.GetProperty("city").GetString().Should().Be("Brumadinho");
        body.GetProperty("state").GetString().Should().Be("MG");
    }

    [Fact]
    public async Task ViaCepDown_BrasilApiAnswers_AfterOneRetry()
    {
        using var host = Start(Down(), FakeProviderHandler.Json(HttpStatusCode.OK, BrasilApiComercio));

        var response = await host.Get("40010000");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await Json(response);
        body.GetProperty("street").GetString().Should().Be("Avenida Estados Unidos");
        body.GetProperty("district").GetString().Should().Be("Comércio");
        body.GetProperty("city").GetString().Should().Be("Salvador");
        body.GetProperty("state").GetString().Should().Be("BA");
        host.ViaCep.Calls.Should().Be(2);
        host.BrasilApi.Paths.Should().Equal("/api/cep/v2/40010000");
    }

    [Fact]
    public async Task ViaCepHangs_TheTimeoutPassesToBrasilApi()
    {
        using var host = Start(FakeProviderHandler.Hang(), FakeProviderHandler.Json(HttpStatusCode.OK, BrasilApiComercio));

        var response = await host.Get("40010000");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Json(response)).GetProperty("city").GetString().Should().Be("Salvador");
    }

    // O ViaCEP responde 200 com "erro" (em booleano ou em texto) para o CEP que não existe.
    [Theory]
    [InlineData("""{ "erro": true }""")]
    [InlineData("""{ "erro": "true" }""")]
    public async Task UnknownToBoth_Returns404NotFound(string viaCepBody)
    {
        using var host = Start(
            FakeProviderHandler.Json(HttpStatusCode.OK, viaCepBody),
            FakeProviderHandler.Json(HttpStatusCode.NotFound, """{ "name": "CepPromiseError" }"""));

        var response = await host.Get("99999999");

        await ShouldBeProblem(response, HttpStatusCode.NotFound, ProblemTypes.NotFound);
        host.BrasilApi.Calls.Should().Be(1);
    }

    [Fact]
    public async Task ViaCepDown_AndBrasilApiDoesNotKnowIt_Returns404()
    {
        using var host = Start(Down(), FakeProviderHandler.Status(HttpStatusCode.NotFound));

        await ShouldBeProblem(await host.Get("99999999"), HttpStatusCode.NotFound, ProblemTypes.NotFound);
    }

    // O "não existe" do ViaCEP vale mais do que nenhuma resposta.
    [Fact]
    public async Task ViaCepDoesNotKnowIt_AndBrasilApiIsDown_Returns404()
    {
        using var host = Start(FakeProviderHandler.Json(HttpStatusCode.OK, """{ "erro": true }"""), Down());

        await ShouldBeProblem(await host.Get("99999999"), HttpStatusCode.NotFound, ProblemTypes.NotFound);
    }

    [Fact]
    public async Task BothDown_Returns503UpstreamUnavailable()
    {
        using var host = Start(Down(), FakeProviderHandler.Json(HttpStatusCode.OK, "<html>não é json"));

        await ShouldBeProblem(await host.Get(ZipCode), HttpStatusCode.ServiceUnavailable, ProblemTypes.UpstreamUnavailable);
    }

    [Theory]
    [InlineData("1234")]
    [InlineData("123456789")]
    [InlineData("12345-678")]
    [InlineData("abcdefgh")]
    [InlineData("１２３４５６７８")]
    public async Task MalformedZipCode_Returns400InZipCode_WithoutCallingAProvider(string zipCode)
    {
        using var host = Start(Down(), Down());

        var response = await host.Get(Uri.EscapeDataString(zipCode));

        var body = await ShouldBeProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        body.GetProperty("errors").GetProperty("zipCode").EnumerateArray().Single().GetString()
            .Should().Be("Informe o CEP com 8 dígitos, sem hífen.");
        host.ViaCep.Calls.Should().Be(0);
        host.BrasilApi.Calls.Should().Be(0);
    }

    [Fact]
    public async Task SecondLookupOfTheSameZipCode_ComesFromTheCache()
    {
        using var host = Start(FakeProviderHandler.Json(HttpStatusCode.OK, ViaCepPaulista), Down());

        var first = await host.Get(ZipCode);
        var second = await host.Get(ZipCode);

        second.StatusCode.Should().Be(HttpStatusCode.OK);
        (await second.Content.ReadAsStringAsync(TestContext.Current.CancellationToken))
            .Should().Be(await first.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        host.ViaCep.Calls.Should().Be(1);
    }

    [Fact]
    public async Task SecondLookupOfAnUnknownZipCode_AlsoComesFromTheCache()
    {
        using var host = Start(
            FakeProviderHandler.Json(HttpStatusCode.OK, """{ "erro": true }"""),
            FakeProviderHandler.Status(HttpStatusCode.NotFound));

        await host.Get("99999999");
        var second = await host.Get("99999999");

        await ShouldBeProblem(second, HttpStatusCode.NotFound, ProblemTypes.NotFound);
        host.ViaCep.Calls.Should().Be(1);
        host.BrasilApi.Calls.Should().Be(1);
    }

    // A falha não entra no cache: a próxima consulta tenta os provedores de novo.
    [Fact]
    public async Task AFailedLookup_IsNotCached()
    {
        using var host = Start(Down(), Down());

        await host.Get(ZipCode);
        var callsAfterFirst = host.ViaCep.Calls;
        await host.Get(ZipCode);

        host.ViaCep.Calls.Should().BeGreaterThan(callsAfterFirst);
    }

    [Fact]
    public async Task WithoutToken_Returns401()
    {
        using var host = Start(FakeProviderHandler.Json(HttpStatusCode.OK, ViaCepPaulista), Down());
        host.Client.DefaultRequestHeaders.Authorization = null;

        await ShouldBeProblem(await host.Get(ZipCode), HttpStatusCode.Unauthorized, ProblemTypes.Unauthorized);
        host.ViaCep.Calls.Should().Be(0);
    }

    [Fact]
    public async Task ThirtyFirstLookupInAMinute_Returns429WithRetryAfter_WithoutLimitingSignIn()
    {
        using var host = Start(FakeProviderHandler.Json(HttpStatusCode.OK, ViaCepPaulista), Down());

        for (var i = 0; i < 30; i++)
        {
            (await host.Get(ZipCode)).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var limited = await host.Get(ZipCode);

        await ShouldBeProblem(limited, HttpStatusCode.TooManyRequests, ProblemTypes.RateLimited);
        int.Parse(limited.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture)
            .Should().BeInRange(1, 60);
        var signIn = await host.Client.PostAsJsonAsync("/api/v1/auth/signin", new { },
            TestContext.Current.CancellationToken);
        signIn.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    private static FakeProviderHandler Down() => FakeProviderHandler.Status(HttpStatusCode.InternalServerError);

    private TestHost Start(FakeProviderHandler viaCep, FakeProviderHandler brasilApi)
    {
        var app = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddHttpClient<ViaCepLookup>().ConfigurePrimaryHttpMessageHandler(() => viaCep);
            services.AddHttpClient<BrasilApiLookup>().ConfigurePrimaryHttpMessageHandler(() => brasilApi);
        }));
        var client = app.CreateClient();
        var token = app.Services.GetRequiredService<AccessTokenGenerator>()
            .Create(new User { Id = Guid.CreateVersion7() });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
        return new TestHost(app, client, viaCep, brasilApi);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).RootElement;

    private static async Task<JsonElement> ShouldBeProblem(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        response.StatusCode.Should().Be(status);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        var body = await Json(response);
        body.GetProperty("type").GetString().Should().Be(type);
        return body;
    }

    private sealed record TestHost(
        WebApplicationFactory<Program> App, HttpClient Client, FakeProviderHandler ViaCep, FakeProviderHandler BrasilApi)
        : IDisposable
    {
        public Task<HttpResponseMessage> Get(string zipCode) =>
            Client.GetAsync($"/api/v1/zip-codes/{zipCode}", TestContext.Current.CancellationToken);

        public void Dispose()
        {
            Client.Dispose();
            App.Dispose();
        }
    }
}
