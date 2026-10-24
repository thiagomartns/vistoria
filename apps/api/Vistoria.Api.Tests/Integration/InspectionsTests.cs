using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using AwesomeAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Tests.Support;

namespace Vistoria.Api.Tests.Integration;

// Dono, versão e idempotência são os do fluxo genérico, cobertos em OptimisticConcurrencyTests e IdempotencyTests;
// aqui ficam o agregado pela API: listas completas, ordem, limites, ids de ambiente e item e o que o PUT não regrava.
// A versão subir por mudança só num filho é do AppDbContext (InspectionAggregateTests); aqui ela é vista pelo ETag.
public class InspectionsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task PutNew_Returns201WithETag_AndGetReturnsRoomsAndItemsSortedByPosition()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(client);

        var put = await Put(client, id, body);

        put.StatusCode.Should().Be(HttpStatusCode.Created);
        put.Headers.Location!.AbsolutePath.Should().Be(PathOf(id));
        var get = await client.GetAsync(PathOf(id), Ct);
        get.StatusCode.Should().Be(HttpStatusCode.OK);
        ETagOf(get).Should().Be(ETagOf(put));
        foreach (var stored in new[] { await Body(put), await Body(get) })
        {
            Version(stored).Should().Be(ETagOf(put));
            stored.GetProperty("id").GetGuid().Should().Be(id);
            stored.GetProperty("propertyId").GetGuid().Should().Be(body.PropertyId);
            stored.GetProperty("kind").GetString().Should().Be("moveIn");
            stored.GetProperty("status").GetString().Should().Be("inProgress");
            stored.GetProperty("startedAt").GetDateTimeOffset().Should().Be(body.StartedAt);
            stored.GetProperty("completedAt").ValueKind.Should().Be(JsonValueKind.Null);
            stored.GetProperty("generalNotes").GetString().Should().Be(body.GeneralNotes);
            stored.GetProperty("createdAt").GetDateTimeOffset().Should().Be(factory.Time.GetUtcNow());
            stored.TryGetProperty("ownerId", out _).Should().BeFalse();
            RoomsOf(stored).Should().BeEquivalentTo(Sorted(body.Rooms), o => o.WithStrictOrdering());
        }
    }

    [Fact]
    public async Task ChangingOnlyOneItem_ChangesTheETag_AndNothingElse()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(client);
        var created = await Put(client, id, body);
        var kitchen = body.Rooms[0];
        var changed = body with
        {
            Rooms = [kitchen with { Items = [kitchen.Items[0] with { Condition = "poor" }, .. kitchen.Items[1..]] },
                .. body.Rooms[1..]],
        };

        var updated = await Put(client, id, changed, ETagOf(created));

        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        ETagOf(updated).Should().NotBe(ETagOf(created));
        var stored = await Body(await client.GetAsync(PathOf(id), Ct));
        Version(stored).Should().Be(ETagOf(updated));
        RoomsOf(stored).Should().BeEquivalentTo(Sorted(changed.Rooms), o => o.WithStrictOrdering());
    }

    [Fact]
    public async Task OmittedRoomAndItem_DisappearFromTheResponse_AndGetDeletedAtInTheDatabase()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(client);
        var created = await Put(client, id, body);
        // Some a cozinha inteira (com os itens) e o primeiro item da sala.
        var (kitchen, living) = (body.Rooms[0], body.Rooms[1]);
        var trimmed = body with { Rooms = [living with { Items = [.. living.Items[1..]] }, .. body.Rooms[2..]] };
        factory.Time.Advance(TimeSpan.FromMinutes(5));

        var updated = await Put(client, id, trimmed, ETagOf(created));

        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        RoomsOf(await Body(updated)).Should().BeEquivalentTo(Sorted(trimmed.Rooms), o => o.WithStrictOrdering());
        RoomsOf(await Body(await client.GetAsync(PathOf(id), Ct)))
            .Should().BeEquivalentTo(Sorted(trimmed.Rooms), o => o.WithStrictOrdering());
        Guid[] gone = [kitchen.Id, .. kitchen.Items.Select(it => it.Id), living.Items[0].Id];
        (await DeletedAtOf(gone)).Should().HaveCount(gone.Length)
            .And.AllSatisfy(d => d.Should().Be(factory.Time.GetUtcNow()));
    }

    [Fact]
    public async Task ResendingAnOmittedRoom_BringsItBackWithItsItems()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(client);
        var created = await Put(client, id, body);
        var trimmed = await Put(client, id, body with { Rooms = [.. body.Rooms[1..]] }, ETagOf(created));

        var restored = await Put(client, id, body, ETagOf(trimmed));

        restored.StatusCode.Should().Be(HttpStatusCode.OK);
        RoomsOf(await Body(restored)).Should().BeEquivalentTo(Sorted(body.Rooms), o => o.WithStrictOrdering());
        (await DeletedAtOf([body.Rooms[0].Id, .. body.Rooms[0].Items.Select(it => it.Id)]))
            .Should().AllSatisfy(d => d.Should().BeNull());
    }

    [Fact]
    public async Task MovingAnItemToAnotherRoom_KeepsItsId()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(client);
        var created = await Put(client, id, body);
        // O primeiro item da cozinha vai para a sala, e a cozinha sai: o item não pode cair junto com ela.
        var (kitchen, living) = (body.Rooms[0], body.Rooms[1]);
        var moved = body with
        {
            Rooms = [living with { Items = [.. living.Items, kitchen.Items[0] with { Position = 9 }] }, .. body.Rooms[2..]],
        };

        var updated = await Put(client, id, moved, ETagOf(created));

        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        RoomsOf(await Body(updated)).Should().BeEquivalentTo(Sorted(moved.Rooms), o => o.WithStrictOrdering());
        (await DeletedAtOf([kitchen.Items[0].Id])).Should().Equal([null]);
    }

    [Fact]
    public async Task Put_IgnoresWhatTheServerDefines_AndKeepsStartedAtOnUpdate()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(client);
        var extras = new JsonObject
        {
            ["completedAt"] = "2026-10-20T13:00:00+00:00",
            ["referenceInspectionId"] = Guid.CreateVersion7().ToString(),
        };
        var created = await Put(client, id, Merge(body, extras));
        created.StatusCode.Should().Be(HttpStatusCode.Created);

        var updated = await Put(client, id, body with { StartedAt = body.StartedAt.AddDays(1) }, ETagOf(created));

        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var stored = await Body(updated);
        stored.GetProperty("startedAt").GetDateTimeOffset().Should().Be(body.StartedAt);
        stored.GetProperty("completedAt").ValueKind.Should().Be(JsonValueKind.Null);
        stored.GetProperty("referenceInspectionId").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Put_AtTheLimits_40RoomsWith60ItemsEach_Returns201_AndRewrites()
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(client) with { Rooms = Rooms(40, itemsPerRoom: 60) };

        var created = await Put(client, id, body);
        var updated = await Put(client, id, body with { GeneralNotes = "Revisada" }, ETagOf(created));

        created.StatusCode.Should().Be(HttpStatusCode.Created);
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var rooms = (await Body(updated)).GetProperty("rooms");
        rooms.GetArrayLength().Should().Be(40);
        rooms.EnumerateArray().Should().AllSatisfy(r => r.GetProperty("items").GetArrayLength().Should().Be(60));
    }

    // Cada linha troca um trecho do corpo válido pelo caminho JSON; o erro sai só nesse caminho.
    public static TheoryData<string, object?> InvalidFields => new()
    {
        { "propertyId", null },
        { "kind", null },
        { "kind", "inspection" },
        { "status", null },
        { "status", "completed" },
        { "startedAt", null },
        { "generalNotes", new string('a', 2001) },
        { "rooms", null },
        { "rooms", Rooms(41, itemsPerRoom: 1) },
        { "rooms[1]", null },
        { "rooms[0].id", null },
        { "rooms[0].name", "" },
        { "rooms[0].name", "   " },
        { "rooms[0].name", new string('a', 61) },
        { "rooms[0].position", -1 },
        { "rooms[0].notes", new string('a', 1001) },
        { "rooms[0].items", null },
        { "rooms[0].items", Items(61) },
        { "rooms[0].items[1]", null },
        { "rooms[0].items[1].id", null },
        { "rooms[0].items[1].name", "" },
        { "rooms[0].items[1].name", new string('a', 61) },
        { "rooms[0].items[1].position", null },
        { "rooms[0].items[1].condition", "broken" },
        { "rooms[0].items[1].notes", new string('a', 1001) },
    };

    [Theory]
    [MemberData(nameof(InvalidFields))]
    public async Task Put_InvalidField_Returns400OnTheExactPath(string path, object? value)
    {
        var client = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();

        var response = await Put(client, id, BodyWith(await ValidBody(client), path, value));

        await AssertErrorsOn(response, path);
        await AssertMissing(client, id);
    }

    [Fact]
    public async Task Put_RepeatedIds_Returns400OnEachRepetition()
    {
        var client = factory.CreateAuthenticatedClient();
        var body = await ValidBody(client);
        var (kitchen, living) = (body.Rooms[0], body.Rooms[1]);
        // Ids únicos na vistoria toda: item de outro ambiente com o mesmo id também é repetido.
        var repeated = body with
        {
            Rooms =
            [
                kitchen,
                living with { Id = kitchen.Id, Items = [living.Items[0] with { Id = kitchen.Items[1].Id }] },
                .. body.Rooms[2..],
            ],
        };

        var response = await Put(client, Guid.CreateVersion7(), repeated);

        await AssertErrorsOn(response, "rooms[1].id", "rooms[1].items[0].id");
    }

    [Fact]
    public async Task Put_ChildIdOfAnotherInspection_Returns400OnItsPath_EvenFromAnotherOwner()
    {
        var other = factory.CreateAuthenticatedClient();
        var theirs = await ValidBody(other);
        (await Put(other, Guid.CreateVersion7(), theirs)).StatusCode.Should().Be(HttpStatusCode.Created);
        var client = factory.CreateAuthenticatedClient();
        var body = await ValidBody(client);
        var (kitchen, living) = (body.Rooms[0], body.Rooms[1]);
        var stolen = body with
        {
            Rooms =
            [
                kitchen with { Id = theirs.Rooms[0].Id },
                living with { Items = [living.Items[0], living.Items[1] with { Id = theirs.Rooms[1].Items[0].Id }] },
            ],
        };

        var response = await Put(client, Guid.CreateVersion7(), stolen);

        await AssertErrorsOn(response, "rooms[0].id", "rooms[1].items[1].id");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Put_PropertyMissingOrFromAnotherOwner_Returns400OnPropertyId(bool otherOwner)
    {
        var client = factory.CreateAuthenticatedClient();
        var propertyId = otherOwner ? await CreateProperty(factory.CreateAuthenticatedClient()) : Guid.CreateVersion7();
        var id = Guid.CreateVersion7();

        var response = await Put(client, id, await ValidBody(client) with { PropertyId = propertyId });

        await AssertErrorsOn(response, "propertyId");
        await AssertMissing(client, id);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Get_MissingOrFromAnotherOwner_Returns404NotFound(bool otherOwner)
    {
        var id = Guid.CreateVersion7();
        if (otherOwner)
        {
            var other = factory.CreateAuthenticatedClient();
            (await Put(other, id, await ValidBody(other))).StatusCode.Should().Be(HttpStatusCode.Created);
        }

        var response = await factory.CreateAuthenticatedClient().GetAsync(PathOf(id), Ct);

        await AssertProblem(response, HttpStatusCode.NotFound, ProblemTypes.NotFound);
    }

    [Fact]
    public async Task Put_FromAnotherOwner_Returns403Forbidden_AndKeepsTheInspection()
    {
        var owner = factory.CreateAuthenticatedClient();
        var id = Guid.CreateVersion7();
        var body = await ValidBody(owner);
        var created = await Put(owner, id, body);
        var intruder = factory.CreateAuthenticatedClient();

        var response = await Put(intruder, id, await ValidBody(intruder) with { Rooms = [] });

        await AssertProblem(response, HttpStatusCode.Forbidden, ProblemTypes.Forbidden);
        var stored = await Body(await owner.GetAsync(PathOf(id), Ct));
        Version(stored).Should().Be(ETagOf(created));
        RoomsOf(stored).Should().BeEquivalentTo(Sorted(body.Rooms), o => o.WithStrictOrdering());
    }

    [Fact]
    public async Task WithoutToken_Returns401()
    {
        var client = factory.CreateClient();
        var id = Guid.CreateVersion7();

        await AssertProblem(await client.GetAsync(PathOf(id), Ct), HttpStatusCode.Unauthorized,
            ProblemTypes.Unauthorized);
        await AssertProblem(await Put(client, id, new { }), HttpStatusCode.Unauthorized, ProblemTypes.Unauthorized);
    }

    private sealed record InspectionBody(
        Guid PropertyId, string Kind, string Status, DateTimeOffset StartedAt, string? GeneralNotes, List<RoomBody> Rooms);

    private sealed record RoomBody(Guid Id, string Name, int Position, string? Notes, List<ItemBody> Items);

    private sealed record ItemBody(Guid Id, string Name, int Position, string? Condition, string? Notes);

    // Ids novos a cada corpo: são únicos entre todas as vistorias. As posições não seguem a ordem da lista nem começam
    // em zero, para a resposta provar que a ordem vem de position.
    private static async Task<InspectionBody> ValidBody(HttpClient client) => new(
        await CreateProperty(client), "moveIn", "inProgress", new DateTimeOffset(2026, 10, 20, 9, 30, 0, TimeSpan.Zero),
        "Imóvel vazio, chaves com o porteiro.",
        [
            new(Guid.CreateVersion7(), "Cozinha", 5, null,
            [
                new(Guid.CreateVersion7(), "Pia", 3, "good", null),
                new(Guid.CreateVersion7(), "Armários", 1, "fair", "Porta solta."),
            ]),
            new(Guid.CreateVersion7(), "Sala", 2, "Pintura nova.",
            [
                new(Guid.CreateVersion7(), "Piso", 0, "new", null),
                new(Guid.CreateVersion7(), "Janelas", 7, null, null),
            ]),
            new(Guid.CreateVersion7(), "Banheiro", 4, null, [new(Guid.CreateVersion7(), "Box", 0, "good", null)]),
        ]);

    private static List<RoomBody> Rooms(int count, int itemsPerRoom) =>
        [.. Enumerable.Range(0, count).Select(r => new RoomBody(Guid.CreateVersion7(), $"Ambiente {r}", r, null, Items(itemsPerRoom)))];

    private static List<ItemBody> Items(int count) =>
        [.. Enumerable.Range(0, count).Select(i => new ItemBody(Guid.CreateVersion7(), $"Item {i}", i, null, null))];

    // O que a API devolve: ambientes e itens em ordem de position.
    private static List<RoomBody> Sorted(List<RoomBody> rooms) =>
        [.. rooms.OrderBy(r => r.Position).Select(r => r with { Items = [.. r.Items.OrderBy(it => it.Position)] })];

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

    // O corpo como JSON, com o valor em `path` (ex.: rooms[0].items[1].name) trocado por outro, de qualquer tipo.
    private static JsonNode BodyWith(InspectionBody body, string path, object? value)
    {
        var root = JsonSerializer.SerializeToNode(body, JsonSerializerOptions.Web)!;
        var segments = path.Replace("]", "").Split('.', '[');
        var parent = root;
        foreach (var segment in segments[..^1])
        {
            parent = int.TryParse(segment, out var index) ? parent[index]! : parent[segment]!;
        }

        var replacement = JsonSerializer.SerializeToNode(value, JsonSerializerOptions.Web);
        if (int.TryParse(segments[^1], out var last))
        {
            parent[last] = replacement;
        }
        else
        {
            parent[segments[^1]] = replacement;
        }

        return root;
    }

    private static JsonObject Merge(InspectionBody body, JsonObject extras)
    {
        var root = JsonSerializer.SerializeToNode(body, JsonSerializerOptions.Web)!.AsObject();
        foreach (var (name, value) in extras)
        {
            root[name] = value?.DeepClone();
        }

        return root;
    }

    private static List<RoomBody> RoomsOf(JsonElement body) =>
        body.GetProperty("rooms").Deserialize<List<RoomBody>>(JsonSerializerOptions.Web)!;

    private static string PathOf(Guid id) => $"/api/v1/inspections/{id}";

    // ifMatch é o base64 do ETag (como o ETagOf devolve); vai entre aspas, como ETag forte.
    private static Task<HttpResponseMessage> Put(HttpClient client, Guid id, object body, string? ifMatch = null)
    {
        var request = WriteRequests.Put(PathOf(id), body);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
        }

        return client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    private static string Version(JsonElement body) => body.GetProperty("version").GetString()!;

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

    private static async Task AssertErrorsOn(HttpResponseMessage response, params string[] paths)
    {
        await AssertProblem(response, HttpStatusCode.BadRequest, ProblemTypes.Validation);
        (await Body(response)).GetProperty("errors").EnumerateObject().Select(p => p.Name)
            .Should().BeEquivalentTo(paths);
    }

    private static async Task AssertMissing(HttpClient client, Guid id) =>
        (await client.GetAsync(PathOf(id), Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);

    // DeletedAt de cada ambiente ou item com esses ids, excluídos ou não, direto no banco.
    private async Task<List<DateTimeOffset?>> DeletedAtOf(IReadOnlyCollection<Guid> ids)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rooms = await db.Rooms.IgnoreQueryFilters().Where(r => ids.Contains(r.Id)).Select(r => r.DeletedAt)
            .ToListAsync(Ct);
        var items = await db.InspectionItems.IgnoreQueryFilters().Where(it => ids.Contains(it.Id))
            .Select(it => it.DeletedAt).ToListAsync(Ct);
        return [.. rooms, .. items];
    }
}
