using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Fase 4 (backend.md, "Cabeçalhos" e "Testes de integração"): If-Match, 412, 428 e as corridas → 409. Cada cenário
// roda em clients e properties, que passam pelo mesmo SyncEntityService.
public class OptimisticConcurrencyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static TheoryData<string> Resources => new() { "clients", "properties" };

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_WithCurrentIfMatch_Returns200WithNewETag(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag) = await Create(client, resource);

        var response = await Put(client, resource, id, body, Strong(etag));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        ETagOf(response).Should().NotBe(etag);
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_WithStaleIfMatch_Returns412WithCurrent_AndKeepsTheRecord(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, stale) = await Create(client, resource);
        var latest = ETagOf(await Put(client, resource, id, body, Strong(stale)));

        var response = await Put(client, resource, id, body, Strong(stale));

        await AssertProblem(response, HttpStatusCode.PreconditionFailed, ProblemTypes.VersionConflict);
        var current = (await Body(response)).GetProperty("current");
        current.GetProperty("id").GetGuid().Should().Be(id);
        current.GetProperty("version").GetString().Should().Be(latest);
        ETagOf(await client.GetAsync(PathOf(resource, id), Ct)).Should().Be(latest);
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_ExistingWithoutIfMatch_Returns428WithMissingHeader(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag) = await Create(client, resource);

        var response = await Put(client, resource, id, body, ifMatch: null);

        await AssertProblem(response, (HttpStatusCode)428, ProblemTypes.PreconditionRequired);
        (await Body(response)).GetProperty("missingHeader").GetString().Should().Be("If-Match");
        ETagOf(await client.GetAsync(PathOf(resource, id), Ct)).Should().Be(etag);
    }

    public static TheoryData<string, string> UnusableIfMatch => new()
    {
        { "clients", "weak" }, { "clients", "star" }, { "clients", "garbage" }, { "clients", "unquoted" },
        { "clients", "list" }, { "properties", "weak" }, { "properties", "star" }, { "properties", "unquoted" },
    };

    // Nenhum desses prova sobre qual versão o cliente editou, nem mesmo os que contêm o ETag atual.
    [Theory]
    [MemberData(nameof(UnusableIfMatch))]
    public async Task Put_WithUnusableIfMatch_Returns412(string resource, string kind)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag) = await Create(client, resource);
        var ifMatch = kind switch
        {
            "weak" => $"W/{Strong(etag)}",
            "star" => "*",
            "garbage" => "\"abc\"",
            "unquoted" => etag,
            "list" => $"{Strong(etag)}, {Strong(etag)}",
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };

        var response = await Put(client, resource, id, body, ifMatch);

        await AssertProblem(response, HttpStatusCode.PreconditionFailed, ProblemTypes.VersionConflict);
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_NewIdWithIfMatch_IgnoresIt_AndReturns201(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var body = await NewBody(client, resource);

        var response = await Put(client, resource, Guid.CreateVersion7(), body, "\"AAAAAAAAB9E=\"");

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_FromAnotherOwnerWithoutIfMatch_Returns403_Not428(string resource)
    {
        var (id, _, _) = await Create(factory.CreateAuthenticatedClient(), resource);
        var intruder = factory.CreateAuthenticatedClient();

        var response = await Put(intruder, resource, id, await NewBody(intruder, resource), ifMatch: null);

        await AssertProblem(response, HttpStatusCode.Forbidden, ProblemTypes.Forbidden);
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_WhenAnotherUpdateWinsTheRace_Returns409WithCurrent(string resource)
    {
        var ownerId = Guid.CreateVersion7();
        var (id, body, etag) = await Create(factory.CreateAuthenticatedClient(ownerId), resource);
        var injector = new RaceInjector();
        await using var raceHost = RaceHost(injector);
        injector.LoseNextUpdate(id);

        var response = await Put(Authenticated(raceHost, ownerId), resource, id, body, Strong(etag));

        await AssertProblem(response, HttpStatusCode.Conflict, ProblemTypes.VersionConflict);
        var current = (await Body(response)).GetProperty("current");
        current.GetProperty("id").GetGuid().Should().Be(id);
        var winner = current.GetProperty("version").GetString();
        winner.Should().NotBe(etag);
        ETagOf(await factory.CreateAuthenticatedClient(ownerId).GetAsync(PathOf(resource, id), Ct)).Should().Be(winner);
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_WhenAnotherCreateWinsTheRace_Returns409WithCurrent(string resource)
    {
        var ownerId = Guid.CreateVersion7();
        var body = await NewBody(factory.CreateAuthenticatedClient(ownerId), resource);
        var id = Guid.CreateVersion7();
        var injector = new RaceInjector();
        await using var raceHost = RaceHost(injector);
        injector.LoseNextAdd(id);

        var response = await Put(Authenticated(raceHost, ownerId), resource, id, body, ifMatch: null);

        await AssertProblem(response, HttpStatusCode.Conflict, ProblemTypes.VersionConflict);
        var current = (await Body(response)).GetProperty("current");
        current.GetProperty("id").GetGuid().Should().Be(id);
        current.GetProperty("version").GetString().Should().NotBeNullOrEmpty();
    }

    // Sem o decorator: a ordem real das duas requisições decide se o perdedor cai no If-Match (412) ou no
    // SaveChanges (409). O que não pode é os dois vencerem, ou um 500.
    [Theory]
    [MemberData(nameof(Resources))]
    public async Task ParallelPuts_WithTheSameVersion_OneWins_TheOtherIsAVersionConflict(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag) = await Create(client, resource);

        var responses = await Task.WhenAll(
            Put(client, resource, id, body, Strong(etag)),
            Put(client, resource, id, body, Strong(etag)));

        responses.Select(r => r.StatusCode).Should().ContainSingle(s => s == HttpStatusCode.OK);
        var loser = responses.Single(r => r.StatusCode != HttpStatusCode.OK);
        loser.StatusCode.Should().BeOneOf(HttpStatusCode.Conflict, HttpStatusCode.PreconditionFailed);
        (await Body(loser)).GetProperty("type").GetString().Should().Be(ProblemTypes.VersionConflict);
    }

    // Mesma API, com o repositório que perde a corrida quando o RaceInjector mandar.
    private WebApplicationFactory<Program> RaceHost(RaceInjector injector) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton(injector);
            services.Replace(ServiceDescriptor.Scoped(typeof(IRepository<>), typeof(RaceInjectingRepository<>)));
        }));

    private HttpClient Authenticated(WebApplicationFactory<Program> host, Guid ownerId)
    {
        var token = factory.Services.GetRequiredService<AccessTokenGenerator>().Create(new User { Id = ownerId });
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
        return client;
    }

    private static async Task<(Guid Id, object Body, string ETag)> Create(HttpClient client, string resource)
    {
        var body = await NewBody(client, resource);
        var id = Guid.CreateVersion7();
        var response = await Put(client, resource, id, body, ifMatch: null);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (id, body, ETagOf(response));
    }

    private static async Task<object> NewBody(HttpClient client, string resource)
    {
        if (resource == "clients")
        {
            return new { name = "Maria Locadora" };
        }

        var (clientId, _, _) = await Create(client, "clients");
        return new
        {
            clientId,
            street = "Rua Direita",
            number = "10",
            district = "Centro",
            city = "Salvador",
            state = "BA",
            zipCode = "40020000",
            type = "commercial",
        };
    }

    private static string PathOf(string resource, Guid id) => $"/api/v1/{resource}/{id}";

    private static string Strong(string etag) => $"\"{etag}\"";

    // ifMatch vai como veio, sem validação do HttpClient, para os testes de valor inválido.
    private static Task<HttpResponseMessage> Put(
        HttpClient client, string resource, Guid id, object body, string? ifMatch)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, PathOf(resource, id)) { Content = JsonContent.Create(body) };
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    // ETag forte: o base64 entre aspas. Devolve o base64, para comparar com o version do corpo.
    private static string ETagOf(HttpResponseMessage response)
    {
        var etag = response.Headers.ETag!;
        etag.IsWeak.Should().BeFalse();
        return etag.Tag.Trim('"');
    }

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        response.StatusCode.Should().Be(status);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await Body(response)).GetProperty("type").GetString().Should().Be(type);
    }
}
