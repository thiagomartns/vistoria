using System.Net;
using System.Text.Json;
using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

public class ErrorHandlingTests(TestControllersFactory factory) : IClassFixture<TestControllersFactory>
{
    private static readonly string[] BaseMembers = ["type", "title", "status", "detail", "traceId"];

    private readonly HttpClient _client = factory.CreateClient();

    // Fora das rotas públicas, sem token a resposta é 401 antes de o roteamento dizer 404 ou 405.
    private readonly HttpClient _authenticated = factory.CreateAuthenticatedClient();

    public static TheoryData<string, int, string, string[]> Cases => new()
    {
        { "validation", 400, ProblemTypes.Validation, ["errors"] },
        { "invalid-cursor", 400, ProblemTypes.InvalidCursor, [] },
        { "unauthorized", 401, ProblemTypes.Unauthorized, [] },
        { "invalid-credentials", 401, ProblemTypes.InvalidCredentials, [] },
        { "forbidden", 403, ProblemTypes.Forbidden, [] },
        { "not-found", 404, ProblemTypes.NotFound, [] },
        { "unsupported-request", 415, ProblemTypes.UnsupportedRequest, [] },
        { "version-conflict-409", 409, ProblemTypes.VersionConflict, ["current"] },
        { "version-conflict-412", 412, ProblemTypes.VersionConflict, ["current"] },
        { "idempotency-in-progress", 409, ProblemTypes.IdempotencyInProgress, [] },
        { "locked", 409, ProblemTypes.Locked, ["current"] },
        { "deleted", 410, ProblemTypes.Deleted, ["deletedAt"] },
        { "cursor-expired", 410, ProblemTypes.CursorExpired, [] },
        { "idempotency-key-reused", 422, ProblemTypes.IdempotencyKeyReused, [] },
        { "precondition-required", 428, ProblemTypes.PreconditionRequired, ["missingHeader"] },
        { "rate-limited", 429, ProblemTypes.RateLimited, [] },
        { "internal", 500, ProblemTypes.Internal, [] },
    };

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task AppException_BecomesProblemDetailsFromCatalog(
        string name, int status, string type, string[] extensions)
    {
        var (response, body) = await GetProblem($"/test/errors/{name}");

        AssertProblem(response, body, status, type);
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(BaseMembers.Concat(extensions));
    }

    [Fact]
    public async Task Extensions_CarryTheirValues()
    {
        var (_, validation) = await GetProblem("/test/errors/validation");
        validation.GetProperty("errors").GetProperty("name")[0].GetString().Should().Be("Obrigatório.");

        var (_, conflict) = await GetProblem("/test/errors/version-conflict-412");
        conflict.GetProperty("current").GetProperty("version").GetString().Should().Be("AAAAAAAAB9E=");

        var (_, locked) = await GetProblem("/test/errors/locked");
        locked.GetProperty("current").GetProperty("version").GetString().Should().Be("AAAAAAAAB9E=");

        var (_, deleted) = await GetProblem("/test/errors/deleted");
        deleted.GetProperty("deletedAt").GetDateTimeOffset()
            .Should().Be(new DateTimeOffset(2026, 10, 20, 12, 0, 0, TimeSpan.FromHours(-3)));

        var (_, precondition) = await GetProblem("/test/errors/precondition-required");
        precondition.GetProperty("missingHeader").GetString().Should().Be("If-Match");
    }

    [Theory]
    [InlineData("idempotency-in-progress", "2")]
    [InlineData("rate-limited", "10")]
    public async Task RetryableErrors_SendRetryAfterInSeconds(string name, string seconds)
    {
        var (response, _) = await GetProblem($"/test/errors/{name}");

        response.Headers.GetValues("Retry-After").Should().Equal(seconds);
    }

    [Fact]
    public async Task UnhandledException_Returns500InternalWithoutLeakingDetails()
    {
        var response = await _client.GetAsync("/test/errors/unhandled", TestContext.Current.CancellationToken);
        var raw = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var body = JsonDocument.Parse(raw).RootElement;

        AssertProblem(response, body, 500, ProblemTypes.Internal);
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(BaseMembers);
        raw.Should().NotContain("segredo-do-servidor")
            .And.NotContain(nameof(InvalidOperationException))
            .And.NotContain("ThrowingController")
            .And.NotContain(" at ");
    }

    [Fact]
    public async Task UnknownRoute_Returns404NotFound()
    {
        var response = await _authenticated.GetAsync("/api/v1/rota-que-nao-existe", TestContext.Current.CancellationToken);
        var body = await ReadBody(response);

        AssertProblem(response, body, 404, ProblemTypes.NotFound);
        body.GetProperty("type").GetString().Should().Be("urn:vistoria:problem:not-found");
    }

    [Fact]
    public async Task WrongMethod_Returns405UnsupportedRequest()
    {
        var response = await _authenticated.PostAsync("/api/v1/health", null, TestContext.Current.CancellationToken);
        var body = await ReadBody(response);

        AssertProblem(response, body, 405, ProblemTypes.UnsupportedRequest);
    }

    private async Task<(HttpResponseMessage Response, JsonElement Body)> GetProblem(string path)
    {
        var response = await _client.GetAsync(path, TestContext.Current.CancellationToken);
        return (response, await ReadBody(response));
    }

    private static async Task<JsonElement> ReadBody(HttpResponseMessage response)
    {
        var raw = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        return JsonDocument.Parse(raw).RootElement;
    }

    private static void AssertProblem(HttpResponseMessage response, JsonElement body, int status, string type)
    {
        response.StatusCode.Should().Be((HttpStatusCode)status);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        body.GetProperty("type").GetString().Should().Be(type);
        body.GetProperty("title").GetString().Should().Be(ProblemTypes.TitleOf(type));
        body.GetProperty("status").GetInt32().Should().Be(status);
        body.GetProperty("detail").GetString().Should().NotBeNullOrWhiteSpace();
        body.GetProperty("traceId").GetString().Should().NotBeNullOrWhiteSpace();
    }
}
