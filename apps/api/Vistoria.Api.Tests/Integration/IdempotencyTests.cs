using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Vistoria.Api.Configurations;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Fase 5 (backend.md, "Idempotência" e "Testes de integração"): Idempotency-Key, 409 idempotency-in-progress, 422 e
// a chave vencida. Cada cenário roda em clients, properties, templates e inspections, que passam pelo mesmo
// IdempotencyFilter; o DELETE, só em inspections.
public class IdempotencyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(30);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static TheoryData<string> Resources => new() { "clients", "properties", "templates", "inspections" };

    public static TheoryData<string, string> UnusableKeys => new()
    {
        { "clients", "missing" }, { "clients", "garbage" }, { "clients", "v4" }, { "clients", "two" },
        { "properties", "missing" }, { "properties", "v4" }, { "templates", "missing" }, { "templates", "v4" },
        { "inspections", "missing" }, { "inspections", "v4" },
    };

    // Sem uma chave v7 não há como reconhecer o reenvio: nada é executado.
    [Theory]
    [MemberData(nameof(UnusableKeys))]
    public async Task Put_WithoutAUsableKey_Returns428WithMissingHeader_AndWritesNothing(string resource, string kind)
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var request = new HttpRequestMessage(HttpMethod.Put, PathOf(resource, id))
        {
            Content = JsonContent.Create(await NewBody(client, resource)),
        };
        string[] values = kind switch
        {
            "missing" => [],
            "garbage" => ["abc"],
            "v4" => [Guid.NewGuid().ToString()],
            "two" => [Guid.CreateVersion7().ToString(), Guid.CreateVersion7().ToString()],
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        if (values.Length > 0)
        {
            request.Headers.TryAddWithoutValidation("Idempotency-Key", values);
        }

        var response = await client.SendAsync(request, Ct);

        await AssertProblem(response, (HttpStatusCode)428, ProblemTypes.PreconditionRequired);
        (await Body(response)).GetProperty("missingHeader").GetString().Should().Be("Idempotency-Key");
        (await client.GetAsync(PathOf(resource, id), Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_CreateSentTwiceWithTheSameKey_ReturnsTheSameResponse_AndWritesOnce(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var body = await NewBody(client, resource);
        var id = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();

        var first = await Put(client, resource, id, body, key: key);
        var second = await Put(client, resource, id, body, key: key);

        first.StatusCode.Should().Be(HttpStatusCode.Created);
        await AssertSameResponse(second, first);
        second.Headers.Location.Should().Be(first.Headers.Location);
        ETagOf(await client.GetAsync(PathOf(resource, id), Ct)).Should().Be(ETagOf(first));
    }

    // Sem a idempotência, o reenvio com o mesmo If-Match daria 412: a primeira execução já subiu a versão.
    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_UpdateSentTwiceWithTheSameKey_ReturnsTheSame200_AndWritesOnce(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag, _) = await Create(client, resource);
        var key = Guid.CreateVersion7();

        var first = await Put(client, resource, id, body, Strong(etag), key);
        var second = await Put(client, resource, id, body, Strong(etag), key);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertSameResponse(second, first);
        ETagOf(await client.GetAsync(PathOf(resource, id), Ct)).Should().Be(ETagOf(first));
    }

    // Erro final também é gravado: o traceId igual prova que é a resposta gravada, não uma nova execução.
    [Fact]
    public async Task Put_FinalErrorSentTwiceWithTheSameKey_ReturnsTheSameProblem()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();

        var first = await Put(client, "clients", id, new { name = "" }, key: key);
        var second = await Put(client, "clients", id, new { name = "" }, key: key);

        await AssertProblem(first, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        await AssertSameResponse(second, first);
    }

    // Os dois hosts são duas instâncias da API no mesmo banco: o "em processamento" é a linha, não um lock em memória.
    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_SameKeyWhileTheFirstIsProcessing_Returns409InProgress_OnTheSameHostAndOnAnother(
        string resource)
    {
        var ownerId = Guid.CreateVersion7();
        var gate = new WriteGate();
        await using var gatedHost = GatedHost(gate);
        var gated = Authenticated(gatedHost, ownerId);
        var other = factory.CreateAuthenticatedClient(ownerId);
        var body = await NewBody(other, resource);
        var id = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();
        var hold = gate.HoldNext(id);

        var firstTask = Put(gated, resource, id, body, key: key);
        await hold.Entered.WaitAsync(Patience, Ct);
        var sameHost = await Put(gated, resource, id, body, key: key);
        var otherHost = await Put(other, resource, id, body, key: key);
        hold.Release();
        var first = await firstTask.WaitAsync(Patience, Ct);
        var afterwards = await Put(other, resource, id, body, key: key);

        foreach (var response in new[] { sameHost, otherHost })
        {
            await AssertProblem(response, HttpStatusCode.Conflict, ProblemTypes.IdempotencyInProgress);
            response.Headers.RetryAfter!.Delta.Should().Be(IdempotencyConfig.InProgressRetryAfter);
        }

        first.StatusCode.Should().Be(HttpStatusCode.Created);
        await AssertSameResponse(afterwards, first);
        ETagOf(await other.GetAsync(PathOf(resource, id), Ct)).Should().Be(ETagOf(first));
    }

    // Sem portão: a ordem real decide quem vê o processing e quem vê o done. O que não pode é dois efeitos ou 500.
    [Theory]
    [MemberData(nameof(Resources))]
    public async Task ParallelPuts_WithTheSameKey_WriteOnce_AndNeverFail(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var body = await NewBody(client, resource);
        var id = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();

        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => Put(client, resource, id, body, key: key)));

        responses.Should().Contain(r => r.StatusCode == HttpStatusCode.Created);
        var created = responses.Where(r => r.StatusCode == HttpStatusCode.Created).ToList();
        created.Select(ETagOf).Distinct().Should().ContainSingle();
        foreach (var response in responses.Except(created))
        {
            await AssertProblem(response, HttpStatusCode.Conflict, ProblemTypes.IdempotencyInProgress);
        }

        ETagOf(await client.GetAsync(PathOf(resource, id), Ct)).Should().Be(ETagOf(created[0]));
    }

    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_SameKeyWithAnotherBodyOrRoute_Returns422_AndChangesNothing(string resource)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, etag, key) = await Create(client, resource);
        var otherId = Guid.CreateVersion7();

        var otherBody = await Put(client, resource, id, Changed(body), Strong(etag), key);
        var otherRoute = await Put(client, resource, otherId, body, key: key);

        await AssertProblem(otherBody, HttpStatusCode.UnprocessableEntity, ProblemTypes.IdempotencyKeyReused);
        await AssertProblem(otherRoute, HttpStatusCode.UnprocessableEntity, ProblemTypes.IdempotencyKeyReused);
        ETagOf(await client.GetAsync(PathOf(resource, id), Ct)).Should().Be(etag);
        (await client.GetAsync(PathOf(resource, otherId), Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // Até 7 dias o reenvio é a resposta gravada; depois a chave venceu, o PUT reexecuta com o If-Match antigo e cai
    // no 412 de sempre, com current igual ao corpo (o front trata como sucesso).
    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_ResentAfterTheKeyExpired_Returns412WithCurrentEqualToTheBody(string resource)
    {
        var ownerId = Guid.CreateVersion7();
        var (id, body, etag, _) = await Create(factory.CreateAuthenticatedClient(ownerId), resource);
        var changed = Changed(body);
        var key = Guid.CreateVersion7();
        var first = await Put(factory.CreateAuthenticatedClient(ownerId), resource, id, changed, Strong(etag), key);
        first.StatusCode.Should().Be(HttpStatusCode.OK);

        factory.Time.Advance(IdempotencyConfig.KeyValidity - TimeSpan.FromSeconds(1));
        var stillValid = await Put(factory.CreateAuthenticatedClient(ownerId), resource, id, changed, Strong(etag), key);
        factory.Time.Advance(TimeSpan.FromSeconds(2));
        var expired = await Put(factory.CreateAuthenticatedClient(ownerId), resource, id, changed, Strong(etag), key);

        await AssertSameResponse(stillValid, first);
        await AssertProblem(expired, HttpStatusCode.PreconditionFailed, ProblemTypes.VersionConflict);
        var current = (await Body(expired)).GetProperty("current");
        current.GetProperty("version").GetString().Should().Be(ETagOf(first));
        foreach (var (field, value) in changed)
        {
            current.GetProperty(field).GetRawText().Should().Be(JsonSerializer.Serialize(value), field);
        }
    }

    // 5xx não é resposta final: a chave sai, e o retry com ela executa de verdade.
    [Theory]
    [MemberData(nameof(Resources))]
    public async Task Put_ServerError_ReleasesTheKey_AndTheRetryRuns(string resource)
    {
        var ownerId = Guid.CreateVersion7();
        var gate = new WriteGate();
        await using var gatedHost = GatedHost(gate);
        var client = Authenticated(gatedHost, ownerId);
        var body = await NewBody(client, resource);
        var id = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();
        gate.FailNext(id);

        var failed = await Put(client, resource, id, body, key: key);
        var retried = await Put(client, resource, id, body, key: key);

        await AssertProblem(failed, HttpStatusCode.InternalServerError, ProblemTypes.Internal);
        retried.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Put_SameKeyFromAnotherUser_IsIndependent()
    {
        var key = Guid.CreateVersion7();
        var first = await Put(factory.CreateAuthenticatedClient(), "clients", Guid.CreateVersion7(),
            new { name = "Maria" }, key: key);

        var second = await Put(factory.CreateAuthenticatedClient(), "clients", Guid.CreateVersion7(),
            new { name = "João" }, key: key);

        first.StatusCode.Should().Be(HttpStatusCode.Created);
        second.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    // O 401 vem antes do filtro: a chave não é gravada, e o envio autenticado com ela executa.
    [Fact]
    public async Task Put_Unauthorized_DoesNotTakeTheKey()
    {
        var id = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();
        var body = new { name = "Maria" };

        var unauthorized = await Put(factory.CreateClient(), "clients", id, body, key: key);
        var authorized = await Put(factory.CreateAuthenticatedClient(), "clients", id, body, key: key);

        await AssertProblem(unauthorized, HttpStatusCode.Unauthorized, ProblemTypes.Unauthorized);
        authorized.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    // DELETE passa pelo mesmo filtro (só a vistoria tem DELETE na V1).
    [Fact]
    public async Task Delete_WithoutAKey_Returns428WithMissingHeader_AndDeletesNothing()
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, _, etag, _) = await Create(client, "inspections");
        var request = new HttpRequestMessage(HttpMethod.Delete, PathOf("inspections", id));
        request.Headers.TryAddWithoutValidation("If-Match", Strong(etag));

        var response = await client.SendAsync(request, Ct);

        await AssertProblem(response, (HttpStatusCode)428, ProblemTypes.PreconditionRequired);
        (await Body(response)).GetProperty("missingHeader").GetString().Should().Be("Idempotency-Key");
        ETagOf(await client.GetAsync(PathOf("inspections", id), Ct)).Should().Be(etag);
    }

    [Fact]
    public async Task Delete_SentTwiceWithTheSameKey_ReturnsTheSame204()
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, _, etag, _) = await Create(client, "inspections");
        var key = Guid.CreateVersion7();

        var first = await Delete(client, id, Strong(etag), key);
        var second = await Delete(client, id, Strong(etag), key);

        first.StatusCode.Should().Be(HttpStatusCode.NoContent);
        await AssertSameResponse(second, first);
        (await client.GetAsync(PathOf("inspections", id), Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // Reexecutado, o segundo DELETE traria no current a versão da edição feita no meio; gravado, traz a de antes.
    [Fact]
    public async Task Delete_FinalErrorSentTwiceWithTheSameKey_ReturnsTheRecordedProblem()
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, stale, _) = await Create(client, "inspections");
        var latest = ETagOf(await Put(client, "inspections", id, Changed(body), Strong(stale)));
        var key = Guid.CreateVersion7();

        var first = await Delete(client, id, Strong(stale), key);
        await Put(client, "inspections", id, body, Strong(latest));
        var second = await Delete(client, id, Strong(stale), key);

        await AssertProblem(first, HttpStatusCode.PreconditionFailed, ProblemTypes.VersionConflict);
        (await Body(first)).GetProperty("current").GetProperty("version").GetString().Should().Be(latest);
        await AssertSameResponse(second, first);
    }

    [Fact]
    public async Task Delete_WithTheKeyOfAPut_Returns422_AndDeletesNothing()
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, _, etag, key) = await Create(client, "inspections");

        var response = await Delete(client, id, Strong(etag), key);

        await AssertProblem(response, HttpStatusCode.UnprocessableEntity, ProblemTypes.IdempotencyKeyReused);
        ETagOf(await client.GetAsync(PathOf("inspections", id), Ct)).Should().Be(etag);
    }

    [Fact]
    public async Task Delete_SameKeyWhileTheFirstIsProcessing_Returns409InProgress()
    {
        var ownerId = Guid.CreateVersion7();
        var gate = new WriteGate();
        await using var gatedHost = GatedHost(gate);
        var gated = Authenticated(gatedHost, ownerId);
        var (id, _, etag, _) = await Create(factory.CreateAuthenticatedClient(ownerId), "inspections");
        var key = Guid.CreateVersion7();
        var hold = gate.HoldNext(id);

        var firstTask = Delete(gated, id, Strong(etag), key);
        await hold.Entered.WaitAsync(Patience, Ct);
        var second = await Delete(gated, id, Strong(etag), key);
        hold.Release();
        var first = await firstTask.WaitAsync(Patience, Ct);

        await AssertProblem(second, HttpStatusCode.Conflict, ProblemTypes.IdempotencyInProgress);
        second.Headers.RetryAfter!.Delta.Should().Be(IdempotencyConfig.InProgressRetryAfter);
        first.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    // Mesma API, com o repositório que passa pelo WriteGate antes de gravar.
    private WebApplicationFactory<Program> GatedHost(WriteGate gate) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton(gate);
            services.Replace(ServiceDescriptor.Scoped(typeof(IRepository<>), typeof(GatedRepository<>)));
            services.Replace(ServiceDescriptor.Scoped<IInspectionRepository, GatedInspectionRepository>());
        }));

    private HttpClient Authenticated(WebApplicationFactory<Program> host, Guid ownerId)
    {
        var token = factory.Services.GetRequiredService<AccessTokenGenerator>().Create(new User { Id = ownerId });
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
        return client;
    }

    private static async Task<(Guid Id, Dictionary<string, object?> Body, string ETag, Guid Key)> Create(
        HttpClient client, string resource)
    {
        var body = await NewBody(client, resource);
        var id = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();
        var response = await Put(client, resource, id, body, key: key);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (id, body, ETagOf(response), key);
    }

    private static async Task<Dictionary<string, object?>> NewBody(HttpClient client, string resource)
    {
        if (resource == "clients")
        {
            return new() { ["name"] = "Maria Locadora", ["phone"] = "71 3333-0000" };
        }

        // Ambientes como objetos anônimos em camelCase, para o JSON serializado bater com o current da resposta.
        if (resource == "templates")
        {
            return new()
            {
                ["name"] = "Apartamento",
                ["rooms"] = new[]
                {
                    new { id = Guid.CreateVersion7(), name = "Sala", position = 0, items = new[]
                    {
                        new { id = Guid.CreateVersion7(), name = "Piso", position = 0 },
                    } },
                },
            };
        }

        if (resource == "inspections")
        {
            var (propertyId, _, _, _) = await Create(client, "properties");
            return new()
            {
                ["propertyId"] = propertyId,
                ["kind"] = "moveIn",
                ["status"] = "inProgress",
                ["startedAt"] = ApiFactory.Start,
                ["generalNotes"] = null,
                // Os campos de referência são só de saída (ignorados na entrada): vão nulos para bater com o current.
                ["rooms"] = new[]
                {
                    new { id = Guid.CreateVersion7(), name = "Sala", position = 0, notes = (string?)null, items = new[]
                    {
                        new
                        {
                            id = Guid.CreateVersion7(), name = "Piso", position = 0, condition = "good",
                            notes = (string?)null, referenceCondition = (string?)null, referenceNotes = (string?)null,
                        },
                    } },
                },
            };
        }

        var (clientId, _, _, _) = await Create(client, "clients");
        return new()
        {
            ["clientId"] = clientId,
            ["street"] = "Rua Direita",
            ["number"] = "10",
            ["district"] = "Centro",
            ["city"] = "Salvador",
            ["state"] = "BA",
            ["zipCode"] = "40020000",
            ["type"] = "commercial",
        };
    }

    // Outro corpo para o mesmo registro: o telefone do cliente, o nome do roteiro, as notas da vistoria ou o número do
    // imóvel.
    private static Dictionary<string, object?> Changed(Dictionary<string, object?> body)
    {
        var changed = new Dictionary<string, object?>(body);
        if (changed.ContainsKey("phone"))
        {
            changed["phone"] = "71 3333-4242";
        }
        else if (changed.ContainsKey("kind"))
        {
            changed["generalNotes"] = "Chaves com o porteiro.";
        }
        else if (changed.ContainsKey("rooms"))
        {
            changed["name"] = "Apartamento revisado";
        }
        else
        {
            changed["number"] = "42";
        }

        return changed;
    }

    private static string PathOf(string resource, Guid id) => $"/api/v1/{resource}/{id}";

    private static string Strong(string etag) => $"\"{etag}\"";

    private static Task<HttpResponseMessage> Put(
        HttpClient client, string resource, Guid id, object body, string? ifMatch = null, Guid? key = null)
    {
        var request = WriteRequests.Put(PathOf(resource, id), body, key);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return client.SendAsync(request, Ct);
    }

    private static Task<HttpResponseMessage> Delete(HttpClient client, Guid id, string? ifMatch, Guid? key = null)
    {
        var request = WriteRequests.Delete(PathOf("inspections", id), key);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    private static string ETagOf(HttpResponseMessage response)
    {
        var etag = response.Headers.ETag!;
        etag.IsWeak.Should().BeFalse();
        return etag.Tag.Trim('"');
    }

    // Status, Content-Type, ETag e corpo byte a byte.
    private static async Task AssertSameResponse(HttpResponseMessage actual, HttpResponseMessage expected)
    {
        actual.StatusCode.Should().Be(expected.StatusCode);
        actual.Content.Headers.ContentType.Should().Be(expected.Content.Headers.ContentType);
        actual.Headers.ETag.Should().Be(expected.Headers.ETag);
        (await actual.Content.ReadAsStringAsync(Ct)).Should().Be(await expected.Content.ReadAsStringAsync(Ct));
    }

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        response.StatusCode.Should().Be(status);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await Body(response)).GetProperty("type").GetString().Should().Be(type);
    }
}
