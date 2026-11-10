using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Fase 3 (backend.md, "Regra do agregado" e "Testes de integração"): o PUT com status completed só passa com a vistoria
// completa, ganha o CompletedAt e a autoria do servidor e trava a vistoria. As corridas contra uma conclusão ficam em
// OptimisticConcurrencyTests.
public class InspectionCompletionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Completing_Returns200Completed_WithCompletedAtAndAuthorFromTheServer_IgnoringTheClients()
    {
        var (client, userId) = await AuthorClient("Thiago Martins");
        var id = Guid.CreateVersion7();
        var body = await CompleteBody(client);
        var created = await Put(client, id, body);
        factory.Time.Advance(TimeSpan.FromMinutes(5));
        var completedAt = factory.Time.GetUtcNow();

        var response = await Put(client, id, CompletedWith(body, "2020-01-01T00:00:00+00:00"), ETagOf(created));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        foreach (var stored in new[] { await Body(response), await Body(await client.GetAsync(PathOf(id), Ct)) })
        {
            stored.GetProperty("status").GetString().Should().Be("completed");
            stored.GetProperty("completedAt").GetDateTimeOffset().Should().Be(completedAt);
            AssertAuthor(stored, userId, "Thiago Martins");
            stored.GetProperty("startedAt").GetDateTimeOffset().Should().Be(body.StartedAt);
        }
    }

    // Vistoria feita toda offline, enviada já concluída: a mesma validação, e nasce com CompletedAt e autoria.
    [Fact]
    public async Task CreatingAlreadyCompleted_Returns201WithCompletedAtAndAuthor()
    {
        var (client, userId) = await AuthorClient("Thiago Martins");
        var id = Guid.CreateVersion7();

        var response = await Put(client, id, CompletedWith(await CompleteBody(client), "2020-01-01T00:00:00+00:00"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var stored = await Body(response);
        stored.GetProperty("status").GetString().Should().Be("completed");
        stored.GetProperty("completedAt").GetDateTimeOffset().Should().Be(factory.Time.GetUtcNow());
        AssertAuthor(stored, userId, "Thiago Martins");
    }

    // O nome é copiado na conclusão (ADR 0053): o laudo continua com o nome de quem concluiu naquele momento.
    [Fact]
    public async Task Author_KeepsTheNameFromTheCompletion_WhenTheUserIsRenamedLater()
    {
        var (client, userId) = await AuthorClient("Thiago Martins");
        var (id, _, _, _) = await CreateCompleted(client);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users
                .Where(u => u.Id == userId)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.Name, "Thiago M. Gomes"), Ct);
        }

        AssertAuthor(await Body(await client.GetAsync(PathOf(id), Ct)), userId, "Thiago Martins");
    }

    // Em andamento não tem autoria, nem quando o cliente manda uma.
    [Fact]
    public async Task InProgress_HasNoAuthor_EvenIfTheClientSendsOne()
    {
        var (client, _) = await AuthorClient("Thiago Martins");
        var body = JsonSerializer.SerializeToNode(await CompleteBody(client), JsonSerializerOptions.Web)!.AsObject();
        body["completedBy"] = new JsonObject { ["id"] = Guid.CreateVersion7(), ["name"] = "Outra pessoa" };

        var response = await Put(client, Guid.CreateVersion7(), body);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        (await Body(response)).GetProperty("completedBy").ValueKind.Should().Be(JsonValueKind.Null);
    }

    public static TheoryData<string, string> IncompleteCases => new()
    {
        { "itemWithoutCondition", "rooms[0].items[1].condition" },
        { "noRooms", "rooms" },
        { "roomWithoutItems", "rooms[0].items" },
    };

    [Theory]
    [MemberData(nameof(IncompleteCases))]
    public async Task Completing_Incomplete_Returns400OnTheExactPath_AndStaysInProgress(string kind, string path)
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await CompleteBody(client);
        var created = await Put(client, id, body);
        var incomplete = kind switch
        {
            "itemWithoutCondition" => body with
            {
                Rooms =
                [
                    body.Rooms[0] with
                    {
                        Items = [body.Rooms[0].Items[0], body.Rooms[0].Items[1] with { Condition = null }],
                    },
                    body.Rooms[1],
                ],
            },
            "noRooms" => body with { Rooms = [] },
            "roomWithoutItems" => body with { Rooms = [body.Rooms[0] with { Items = [] }, body.Rooms[1]] },
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };

        var response = await Put(client, id, incomplete with { Status = "completed" }, ETagOf(created));

        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        (await Body(response)).GetProperty("errors").EnumerateObject().Select(p => p.Name).Should().Equal(path);
        var stored = await client.GetAsync(PathOf(id), Ct);
        ETagOf(stored).Should().Be(ETagOf(created));
        (await Body(stored)).GetProperty("status").GetString().Should().Be("inProgress");
    }

    // Em andamento, as mesmas listas incompletas passam: a regra é só da conclusão.
    [Fact]
    public async Task InProgress_WithoutRoomsOrConditions_IsAccepted()
    {
        var client = factory.CreateAuthenticatedClient();
        var body = await CompleteBody(client);

        var noRooms = await Put(client, Guid.CreateVersion7(), body with { Rooms = [] });
        var noCondition = await Put(client, Guid.CreateVersion7(), body with
        {
            Rooms = [body.Rooms[0] with { Items = [body.Rooms[0].Items[0] with { Condition = null }] }],
        });

        noRooms.StatusCode.Should().Be(HttpStatusCode.Created);
        noCondition.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    // Trava antes da versão: nem o If-Match atual nem um velho nem a falta dele mudam a resposta.
    [Theory]
    [InlineData("current")]
    [InlineData("stale")]
    [InlineData("none")]
    public async Task Put_OnCompleted_Returns409LockedWithCurrent(string ifMatch)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, body, stale, completed) = await CreateCompleted(client);

        var response = await Put(client, id, body with { GeneralNotes = "Depois de concluir." }, ifMatch switch
        {
            "current" => completed,
            "stale" => stale,
            _ => null,
        });

        await AssertLocked(response, id, completed);
        ETagOf(await client.GetAsync(PathOf(id), Ct)).Should().Be(completed);
    }

    [Theory]
    [InlineData("current")]
    [InlineData("stale")]
    public async Task Delete_OnCompleted_Returns409LockedWithCurrent(string ifMatch)
    {
        var client = factory.CreateAuthenticatedClient();
        var (id, _, stale, completed) = await CreateCompleted(client);

        var response = await Delete(client, id, ifMatch == "current" ? completed : stale);

        await AssertLocked(response, id, completed);
        ETagOf(await client.GetAsync(PathOf(id), Ct)).Should().Be(completed);
    }

    // "Pronto quando" da fase 3: a conclusão reenviada pela outbox (mesma chave) é a resposta gravada, não um locked.
    [Fact]
    public async Task CompletingPut_ResentWithTheSameKey_ReturnsTheRecordedResponse_NotLocked()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await CompleteBody(client);
        var created = await Put(client, id, body);
        var key = Guid.CreateVersion7();

        var first = await Put(client, id, body with { Status = "completed" }, ETagOf(created), key);
        var second = await Put(client, id, body with { Status = "completed" }, ETagOf(created), key);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        second.Headers.ETag.Should().Be(first.Headers.ETag);
        (await second.Content.ReadAsStringAsync(Ct)).Should().Be(await first.Content.ReadAsStringAsync(Ct));
    }

    private sealed record InspectionBody(
        Guid PropertyId, string Kind, string Status, DateTimeOffset StartedAt, string? GeneralNotes, List<RoomBody> Rooms);

    private sealed record RoomBody(Guid Id, string Name, int Position, List<ItemBody> Items);

    private sealed record ItemBody(Guid Id, string Name, int Position, string? Condition);

    // Em andamento, com todos os itens avaliados: só falta o status para concluir.
    private static async Task<InspectionBody> CompleteBody(HttpClient client) => new(
        await CreateProperty(client), "moveIn", "inProgress", new DateTimeOffset(2026, 10, 20, 9, 30, 0, TimeSpan.Zero),
        null,
        [
            new(Guid.CreateVersion7(), "Sala", 0,
            [
                new(Guid.CreateVersion7(), "Piso", 0, "good"),
                new(Guid.CreateVersion7(), "Janelas", 1, "fair"),
            ]),
            new(Guid.CreateVersion7(), "Cozinha", 1, [new(Guid.CreateVersion7(), "Pia", 0, "new")]),
        ]);

    // Criada e concluída: devolve o ETag de antes da conclusão (velho) e o atual.
    private static async Task<(Guid Id, InspectionBody Body, string Stale, string Completed)> CreateCompleted(
        HttpClient client)
    {
        var id = Guid.CreateVersion7();
        var body = await CompleteBody(client);
        var created = await Put(client, id, body);
        var completed = await Put(client, id, body with { Status = "completed" }, ETagOf(created));
        completed.StatusCode.Should().Be(HttpStatusCode.OK);
        return (id, body with { Status = "completed" }, ETagOf(created), ETagOf(completed));
    }

    // O corpo de conclusão com um completedAt e um completedBy do cliente, que o servidor ignora.
    private static JsonObject CompletedWith(InspectionBody body, string completedAt)
    {
        var completed = body with { Status = "completed" };
        var root = JsonSerializer.SerializeToNode(completed, JsonSerializerOptions.Web)!.AsObject();
        root["completedAt"] = completedAt;
        root["completedBy"] = new JsonObject { ["id"] = Guid.CreateVersion7(), ["name"] = "Outra pessoa" };
        return root;
    }

    // Um usuário gravado de verdade, com nome: o CreateAuthenticatedClient só emite o token, sem a linha em users.
    private async Task<(HttpClient Client, Guid UserId)> AuthorClient(string name)
    {
        var userId = Guid.CreateVersion7();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Users.Add(new User
            {
                Id = userId,
                Name = name,
                Email = $"{userId:N}@vistoria.test",
                PasswordHash = "-",
                CreatedAt = factory.Time.GetUtcNow(),
            });
            await db.SaveChangesAsync(Ct);
        }

        return (factory.CreateAuthenticatedClient(userId), userId);
    }

    private static void AssertAuthor(JsonElement stored, Guid userId, string name)
    {
        var author = stored.GetProperty("completedBy");
        author.GetProperty("id").GetGuid().Should().Be(userId);
        author.GetProperty("name").GetString().Should().Be(name);
    }

    private static async Task<Guid> CreateProperty(HttpClient client)
    {
        var clientId = Guid.CreateVersion7();
        (await client.SendAsync(WriteRequests.Put($"/api/v1/clients/{clientId}", new { name = "Maria Locadora" }), Ct))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        var propertyId = Guid.CreateVersion7();
        (await client.SendAsync(WriteRequests.Put($"/api/v1/properties/{propertyId}", new
        {
            clientId,
            street = "Rua Direita",
            number = "10",
            district = "Centro",
            city = "Salvador",
            state = "BA",
            zipCode = "40020000",
            type = "apartment",
        }), Ct)).StatusCode.Should().Be(HttpStatusCode.Created);
        return propertyId;
    }

    private static string PathOf(Guid id) => $"/api/v1/inspections/{id}";

    // ifMatch é o base64 do ETag (como o ETagOf devolve); vai entre aspas, como ETag forte.
    private static Task<HttpResponseMessage> Put(
        HttpClient client, Guid id, object body, string? ifMatch = null, Guid? key = null)
    {
        var request = WriteRequests.Put(PathOf(id), body, key);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
        }

        return client.SendAsync(request, Ct);
    }

    private static Task<HttpResponseMessage> Delete(HttpClient client, Guid id, string ifMatch)
    {
        var request = WriteRequests.Delete(PathOf(id));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
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

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        response.StatusCode.Should().Be(status);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await Body(response)).GetProperty("type").GetString().Should().Be(type);
    }

    private static async Task AssertLocked(HttpResponseMessage response, Guid id, string version)
    {
        await AssertProblem(response, HttpStatusCode.Conflict, ProblemTypes.Locked);
        var current = (await Body(response)).GetProperty("current");
        current.GetProperty("id").GetGuid().Should().Be(id);
        current.GetProperty("status").GetString().Should().Be("completed");
        current.GetProperty("version").GetString().Should().Be(version);
    }
}
